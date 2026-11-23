import AVFoundation
import AVKit
import ExpoModulesCore
import MediaPlayer
import UIKit

// MARK: - Shared track control

/// Disables the pan gestures above a view (the sheet's swipe to dismiss) while a control is dragged,
/// so moving the finger up or down does not take the drag away.
enum SheetGestures {
  static func suspend(above view: UIView) -> [UIGestureRecognizer] {
    var disabled: [UIGestureRecognizer] = []
    var current = view.superview
    while let ancestor = current {
      for recognizer in ancestor.gestureRecognizers ?? [] where recognizer is UIPanGestureRecognizer && recognizer.isEnabled {
        recognizer.isEnabled = false
        disabled.append(recognizer)
      }
      current = ancestor.superview
    }
    return disabled
  }

  static func restore(_ recognizers: [UIGestureRecognizer]) {
    recognizers.forEach { $0.isEnabled = true }
  }
}

/// Apple Music style bar: no knob, drags are relative to where the finger lands, the bar thickens while dragged,
/// and the drag continues wherever the finger goes until it lifts.
final class TrackControl: UIControl {
  var value: Double = 0 {
    didSet { if !isTracking { relayout(animated: false) } }
  }
  var maximum: Double = 1 {
    didSet { relayout(animated: false) }
  }
  var fillColor: UIColor = UIColor.white.withAlphaComponent(0.72) { didSet { applyColors() } }
  var activeFillColor: UIColor = .white { didSet { applyColors() } }
  var trackColor: UIColor = UIColor.white.withAlphaComponent(0.22) { didSet { applyColors() } }

  var onBegin: (() -> Void)?
  var onChange: ((Double) -> Void)?
  var onEnd: ((Double) -> Void)?

  private let trackLayer = CALayer()
  private let fillLayer = CALayer()
  private var startX: CGFloat = 0
  private var startValue: Double = 0
  private var dragValue: Double = 0
  private var suspended: [UIGestureRecognizer] = []
  private var dragging = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    trackLayer.masksToBounds = true
    trackLayer.addSublayer(fillLayer)
    layer.addSublayer(trackLayer)
    applyColors()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    relayout(animated: false)
  }

  private func applyColors() {
    trackLayer.backgroundColor = trackColor.cgColor
    fillLayer.backgroundColor = (dragging ? activeFillColor : fillColor).cgColor
  }

  private func relayout(animated: Bool) {
    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    CATransaction.setAnimationDuration(0.18)
    let height: CGFloat = dragging ? 12 : 7
    trackLayer.frame = CGRect(x: 0, y: (bounds.height - height) / 2, width: bounds.width, height: height)
    trackLayer.cornerRadius = height / 2
    let shown = dragging ? dragValue : value
    let progress = maximum > 0 ? CGFloat(min(max(shown / maximum, 0), 1)) : 0
    fillLayer.frame = CGRect(x: 0, y: 0, width: bounds.width * progress, height: height)
    CATransaction.commit()
  }

  private func clamp(_ value: Double) -> Double {
    min(max(value, 0), maximum)
  }

  override func beginTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
    startX = touch.location(in: self).x
    startValue = value
    dragValue = value
    dragging = true
    suspended = SheetGestures.suspend(above: self)
    applyColors()
    relayout(animated: true)
    onBegin?()
    return true
  }

  override func continueTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
    let dx = touch.location(in: self).x - startX
    dragValue = clamp(startValue + Double(dx / max(bounds.width, 1)) * maximum)
    relayout(animated: false)
    onChange?(dragValue)
    return true
  }

  override func endTracking(_ touch: UITouch?, with event: UIEvent?) {
    finish()
  }

  override func cancelTracking(with event: UIEvent?) {
    finish()
  }

  private func finish() {
    guard dragging else { return }
    SheetGestures.restore(suspended)
    suspended = []
    dragging = false
    value = dragValue
    applyColors()
    relayout(animated: true)
    onEnd?(dragValue)
  }
}

// MARK: - Scrubber

/// Playback position bar. The position only changes on release (`onScrubEnd`), like Apple Music.
public class ScrubberModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Scrubber")

    View(ScrubberView.self) {
      Events("onScrubStart", "onScrubChange", "onScrubEnd")

      Prop("value") { (view: ScrubberView, value: Double) in
        view.control.value = value
      }
      Prop("maximum") { (view: ScrubberView, maximum: Double) in
        view.control.maximum = max(maximum, 0)
      }
    }
  }
}

final class ScrubberView: ExpoView {
  let control = TrackControl(frame: .zero)
  let onScrubStart = EventDispatcher()
  let onScrubChange = EventDispatcher()
  let onScrubEnd = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(control)
    control.onBegin = { [weak self] in self?.onScrubStart([:]) }
    control.onChange = { [weak self] value in self?.onScrubChange(["value": value]) }
    control.onEnd = { [weak self] value in self?.onScrubEnd(["value": value]) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    control.frame = bounds
  }
}

// MARK: - System volume

/// The device volume in the same bar as the scrubber. It follows the hardware buttons (outputVolume) and sets
/// the volume through a hidden MPVolumeView, the only public way to change it.
public class SystemVolumeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SystemVolume")

    View(SystemVolumeView.self) {}
  }
}

final class SystemVolumeView: ExpoView {
  private let control = TrackControl(frame: .zero)
  private let volumeView = MPVolumeView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
  private var observation: NSKeyValueObservation?

  private var systemSlider: UISlider? {
    volumeView.subviews.compactMap { $0 as? UISlider }.first
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Kept in the window (almost invisible) so iOS shows no volume HUD while this slider is on screen.
    volumeView.alpha = 0.01
    volumeView.isUserInteractionEnabled = false
    addSubview(volumeView)
    addSubview(control)

    let session = AVAudioSession.sharedInstance()
    control.maximum = 1
    control.value = Double(session.outputVolume)
    observation = session.observe(\.outputVolume, options: [.new]) { [weak self] session, _ in
      DispatchQueue.main.async {
        guard let self, !self.control.isTracking else { return }
        self.control.value = Double(session.outputVolume)
      }
    }
    control.onChange = { [weak self] value in self?.setVolume(value) }
    control.onEnd = { [weak self] value in self?.setVolume(value) }
  }

  deinit {
    observation?.invalidate()
  }

  private func setVolume(_ value: Double) {
    systemSlider?.value = Float(value)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    control.frame = bounds
  }
}

// MARK: - AirPlay

/// The AirPlay button (AVRoutePickerView): opens the system sheet to pick speakers and headphones.
public class RoutePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RoutePicker")

    View(RoutePickerView.self) {
      Prop("tint") { (view: RoutePickerView, color: UIColor?) in
        view.picker.tintColor = color
      }
      Prop("activeTint") { (view: RoutePickerView, color: UIColor?) in
        view.picker.activeTintColor = color
      }
    }
  }
}

final class RoutePickerView: ExpoView {
  let picker = AVRoutePickerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    picker.prioritizesVideoDevices = false
    addSubview(picker)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    picker.frame = bounds
  }
}

// MARK: - Menu

struct MenuActionRecord: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var systemImage: String?
  @Field var destructive: Bool = false
  /// Actions with a different group are separated by a divider, like Apple Music's menus.
  @Field var group: Int = 0
}

/// A native pull-down menu (UIMenu) that opens when its content is tapped, like Apple Music's "..." menus.
public class MenuButtonModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MenuButton")

    View(MenuButtonView.self) {
      Events("onSelect")

      Prop("actions") { (view: MenuButtonView, actions: [MenuActionRecord]) in
        view.actions = actions
      }
      Prop("title") { (view: MenuButtonView, title: String?) in
        view.menuTitle = title
      }
    }
  }
}

final class MenuButtonView: ExpoView {
  let onSelect = EventDispatcher()
  private let button = UIButton(type: .custom)

  var actions: [MenuActionRecord] = [] { didSet { rebuild() } }
  var menuTitle: String? { didSet { rebuild() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    button.showsMenuAsPrimaryAction = true
    addSubview(button)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    button.frame = bounds
    bringSubviewToFront(button)
  }

  override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    if subview !== button { bringSubviewToFront(button) }
  }

  private func rebuild() {
    button.menu = MenuBuilder.build(title: menuTitle ?? "", actions: actions) { [weak self] id in
      self?.onSelect(["id": id])
    }
  }
}

enum MenuBuilder {
  static func build(title: String = "", actions: [MenuActionRecord], onSelect: @escaping (String) -> Void) -> UIMenu {
    var groups: [Int: [UIMenuElement]] = [:]
    var order: [Int] = []
    for action in actions {
      let item = UIAction(
        title: action.title,
        image: action.systemImage.flatMap { UIImage(systemName: $0) },
        attributes: action.destructive ? .destructive : []
      ) { _ in
        onSelect(action.id)
      }
      if groups[action.group] == nil { order.append(action.group) }
      groups[action.group, default: []].append(item)
    }
    let sections = order.map { UIMenu(title: "", options: .displayInline, children: groups[$0] ?? []) }
    return UIMenu(title: title, children: sections)
  }
}

// MARK: - Context menu (long press with Apple Music style preview card)

/// Native UIContextMenuInteraction for song rows and tiles: long pressing lifts the row into an
/// Apple Music style preview card (cover + title + subtitle) with the native menu below it.
public class ContextMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ContextMenu")

    View(ContextMenuView.self) {
      Events("onSelect", "onPreviewPress")

      Prop("actions") { (view: ContextMenuView, actions: [MenuActionRecord]) in
        view.actions = actions
      }
      Prop("previewTitle") { (view: ContextMenuView, title: String?) in
        view.previewTitle = title
      }
      Prop("previewSubtitle") { (view: ContextMenuView, subtitle: String?) in
        view.previewSubtitle = subtitle
      }
      Prop("previewImages") { (view: ContextMenuView, images: [String]) in
        view.previewImages = images
      }
      Prop("previewHeaders") { (view: ContextMenuView, headers: [String: String]) in
        view.previewHeaders = headers
      }
    }
  }
}

final class ContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onSelect = EventDispatcher()
  let onPreviewPress = EventDispatcher()

  var actions: [MenuActionRecord] = []
  var previewTitle: String?
  var previewSubtitle: String?
  var previewImages: [String] = []
  var previewHeaders: [String: String] = [:]

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard !actions.isEmpty else { return nil }
    // Let the trailing "..." MenuButton handle its own interactions without triggering the row context menu.
    if let hit = hitTest(location, with: nil), Self.isInsideMenuButton(hit, stoppingAt: self) {
      return nil
    }

    let snapshotActions = actions
    let title = previewTitle
    let subtitle = previewSubtitle
    let images = previewImages
    let headers = previewHeaders
    let initialImage = findExistingImage()
    let containerWidth = window?.bounds.width ?? max(bounds.width, 390)
    let cardWidth = min(containerWidth - 32, 360)

    let previewProvider: UIContextMenuContentPreviewProvider? = title.map { previewTitle in
      {
        TrackPreviewController(
          title: previewTitle,
          subtitle: subtitle,
          initialImage: initialImage,
          imageUrls: images,
          imageHeaders: headers,
          cardWidth: cardWidth
        )
      }
    }

    return UIContextMenuConfiguration(identifier: nil, previewProvider: previewProvider) { [weak self] _ in
      MenuBuilder.build(actions: snapshotActions) { id in
        self?.onSelect(["id": id])
      }
    }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    makeTargetedPreview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    makeTargetedPreview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willPerformPreviewActionForMenuWith configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionCommitAnimating
  ) {
    animator.preferredCommitStyle = .dismiss
    animator.addCompletion { [weak self] in
      self?.onPreviewPress([:])
    }
  }

  private func makeTargetedPreview() -> UITargetedPreview? {
    guard window != nil else { return nil }
    let params = UIPreviewParameters()
    params.backgroundColor = .clear
    params.visiblePath = UIBezierPath(roundedRect: bounds, cornerRadius: 12)
    return UITargetedPreview(view: self, parameters: params)
  }

  private func findExistingImage() -> UIImage? {
    for raw in previewImages {
      if let cached = TrackPreviewController.cachedImage(for: raw) { return cached }
      if raw.hasPrefix("file://"), let url = URL(string: raw), let img = UIImage(contentsOfFile: url.path) {
        TrackPreviewController.cacheImage(img, for: raw)
        return img
      }
    }
    return Self.findArtworkImage(in: self)
  }

  private static func findArtworkImage(in view: UIView) -> UIImage? {
    if let imageView = view as? UIImageView,
       let image = imageView.image,
       !image.isSymbolImage,
       view.bounds.width >= 36,
       view.bounds.height >= 36 {
      return image
    }
    for subview in view.subviews {
      if let found = findArtworkImage(in: subview) { return found }
    }
    return nil
  }

  private static func isInsideMenuButton(_ view: UIView, stoppingAt root: UIView) -> Bool {
    var current: UIView? = view
    while let node = current, node !== root {
      if node is MenuButtonView { return true }
      current = node.superview
    }
    return false
  }
}

final class TrackPreviewController: UIViewController {
  private static let cache: NSCache<NSString, UIImage> = {
    let c = NSCache<NSString, UIImage>()
    c.countLimit = 80
    return c
  }()

  static func cachedImage(for key: String) -> UIImage? {
    cache.object(forKey: key as NSString)
  }

  static func cacheImage(_ image: UIImage, for key: String) {
    cache.setObject(image, forKey: key as NSString)
  }

  private let titleText: String
  private let subtitleText: String?
  private let initialImage: UIImage?
  private let imageUrls: [String]
  private let imageHeaders: [String: String]
  private let cardWidth: CGFloat

  private let imageView = UIImageView()
  private let placeholderIcon = UIImageView()
  private var loadTask: URLSessionDataTask?

  init(
    title: String,
    subtitle: String?,
    initialImage: UIImage?,
    imageUrls: [String],
    imageHeaders: [String: String],
    cardWidth: CGFloat
  ) {
    self.titleText = title
    self.subtitleText = subtitle
    self.initialImage = initialImage
    self.imageUrls = imageUrls
    self.imageHeaders = imageHeaders
    self.cardWidth = cardWidth
    super.init(nibName: nil, bundle: nil)
    preferredContentSize = CGSize(width: cardWidth, height: 84)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    loadTask?.cancel()
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    overrideUserInterfaceStyle = .dark
    view.backgroundColor = UIColor(red: 0.11, green: 0.11, blue: 0.13, alpha: 1.0)

    let artBox = UIView()
    artBox.translatesAutoresizingMaskIntoConstraints = false
    artBox.backgroundColor = UIColor(red: 0.16, green: 0.15, blue: 0.21, alpha: 1.0)
    artBox.layer.cornerRadius = 10
    artBox.layer.cornerCurve = .continuous
    artBox.clipsToBounds = true

    let symbolConfig = UIImage.SymbolConfiguration(pointSize: 22, weight: .medium)
    placeholderIcon.translatesAutoresizingMaskIntoConstraints = false
    placeholderIcon.image = UIImage(systemName: "music.note", withConfiguration: symbolConfig)
    placeholderIcon.tintColor = UIColor.white.withAlphaComponent(0.32)
    placeholderIcon.contentMode = .scaleAspectFit

    imageView.translatesAutoresizingMaskIntoConstraints = false
    imageView.contentMode = .scaleAspectFill
    imageView.clipsToBounds = true

    artBox.addSubview(placeholderIcon)
    artBox.addSubview(imageView)

    let titleLabel = UILabel()
    titleLabel.text = titleText
    titleLabel.font = .systemFont(ofSize: 16, weight: .semibold)
    titleLabel.textColor = .white
    titleLabel.numberOfLines = 2
    titleLabel.lineBreakMode = .byTruncatingTail

    let stack = UIStackView(arrangedSubviews: [titleLabel])
    stack.translatesAutoresizingMaskIntoConstraints = false
    stack.axis = .vertical
    stack.spacing = 3

    if let subtitle = subtitleText, !subtitle.isEmpty {
      let subLabel = UILabel()
      subLabel.text = subtitle
      subLabel.font = .systemFont(ofSize: 14, weight: .regular)
      subLabel.textColor = UIColor.white.withAlphaComponent(0.62)
      subLabel.numberOfLines = 1
      subLabel.lineBreakMode = .byTruncatingTail
      stack.addArrangedSubview(subLabel)
    }

    view.addSubview(artBox)
    view.addSubview(stack)

    NSLayoutConstraint.activate([
      artBox.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
      artBox.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      artBox.widthAnchor.constraint(equalToConstant: 60),
      artBox.heightAnchor.constraint(equalToConstant: 60),

      placeholderIcon.centerXAnchor.constraint(equalTo: artBox.centerXAnchor),
      placeholderIcon.centerYAnchor.constraint(equalTo: artBox.centerYAnchor),

      imageView.topAnchor.constraint(equalTo: artBox.topAnchor),
      imageView.bottomAnchor.constraint(equalTo: artBox.bottomAnchor),
      imageView.leadingAnchor.constraint(equalTo: artBox.leadingAnchor),
      imageView.trailingAnchor.constraint(equalTo: artBox.trailingAnchor),

      stack.leadingAnchor.constraint(equalTo: artBox.trailingAnchor, constant: 12),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])

    if let initialImage {
      imageView.image = initialImage
      placeholderIcon.isHidden = true
    } else {
      loadNextImage(index: 0)
    }
  }

  private func loadNextImage(index: Int) {
    guard index < imageUrls.count else { return }
    let raw = imageUrls[index]
    if let cached = Self.cachedImage(for: raw) {
      applyImage(cached)
      return
    }
    guard let url = URL(string: raw) else {
      loadNextImage(index: index + 1)
      return
    }
    if url.isFileURL {
      if let img = UIImage(contentsOfFile: url.path) {
        Self.cacheImage(img, for: raw)
        applyImage(img)
      } else {
        loadNextImage(index: index + 1)
      }
      return
    }

    var request = URLRequest(url: url)
    for (key, value) in imageHeaders {
      request.setValue(value, forHTTPHeaderField: key)
    }
    loadTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 200
      let image = (status >= 200 && status < 300) ? data.flatMap(UIImage.init(data:)) : nil
      DispatchQueue.main.async {
        guard let self else { return }
        if let image {
          Self.cacheImage(image, for: raw)
          self.applyImage(image)
        } else {
          self.loadNextImage(index: index + 1)
        }
      }
    }
    loadTask?.resume()
  }

  private func applyImage(_ image: UIImage) {
    imageView.image = image
    placeholderIcon.isHidden = true
  }
}

// MARK: - Swipe lock

/// Wraps content with a horizontal swipe (artwork, mini player). Once the drag is recognized as horizontal,
/// the pan gestures above (the sheet's swipe to dismiss, the tab bar) are disabled until the finger lifts, so
/// drifting up or down no longer cancels the swipe. The content keeps receiving the touches.
public class SwipeLockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SwipeLock")

    View(SwipeLockView.self) {}
  }
}

final class SwipeLockView: ExpoView, UIGestureRecognizerDelegate {
  private lazy var pan: UIPanGestureRecognizer = {
    let recognizer = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
    recognizer.cancelsTouchesInView = false
    recognizer.delaysTouchesBegan = false
    recognizer.delaysTouchesEnded = false
    recognizer.delegate = self
    return recognizer
  }()
  private var suspended: [UIGestureRecognizer] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addGestureRecognizer(pan)
  }

  @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
    switch recognizer.state {
    case .began:
      suspended = SheetGestures.suspend(above: self)
    case .ended, .cancelled, .failed:
      SheetGestures.restore(suspended)
      suspended = []
    default:
      break
    }
  }

  /// Only horizontal drags lock; vertical ones are left to the sheet and to scroll views.
  override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
    guard recognizer === pan else { return super.gestureRecognizerShouldBegin(recognizer) }
    let velocity = pan.velocity(in: self)
    return abs(velocity.x) > abs(velocity.y)
  }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    true
  }
}

// MARK: - Search tab prominence when inline

/// Keeps the Search tab inside the unified tab bar pill while expanded and promotes it to its own
/// trailing button while the bottom accessory is inline (minimized) on iOS 27+.
public class TabBarSearchPinModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TabBarSearchPin")

    View(TabBarSearchPinView.self) {}
  }
}

final class TabBarSearchPinView: ExpoView {
  private weak var observedTabBarController: UITabBarController?
  private weak var observedAccessoryView: UIView?
  private var traitRegistration: AnyObject?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      if !attachAndSync() {
        DispatchQueue.main.async { [weak self] in
          _ = self?.attachAndSync()
        }
      }
    } else {
      detachObserver()
      if #available(iOS 27.0, *) {
        let controller = observedTabBarController
        observedTabBarController = nil
        DispatchQueue.main.async {
          guard let controller, controller.bottomAccessory == nil, controller.prominentTabIdentifier != nil else {
            return
          }
          Self.applyProminentTab(nil, on: controller)
        }
      }
    }
  }

  private func detachObserver() {
    if #available(iOS 27.0, *), let reg = traitRegistration as? UITraitChangeRegistration {
      observedAccessoryView?.unregisterForTraitChanges(reg)
    }
    traitRegistration = nil
    observedAccessoryView = nil
  }

  @discardableResult
  private func attachAndSync() -> Bool {
    guard #available(iOS 27.0, *), window != nil, let controller = findTabBarController() else { return false }
    observedTabBarController = controller
    // Observe bottomAccessory.contentView directly: RNSTabsBottomAccessoryHelper hides the inactive
    // regular/inline child view, whereas contentView stays visible and receives every
    // UITraitTabAccessoryEnvironment transition synchronously in both directions.
    let targetView = controller.bottomAccessory?.contentView ?? self
    if observedAccessoryView !== targetView {
      detachObserver()
      observedAccessoryView = targetView
      traitRegistration = targetView.registerForTraitChanges([UITraitTabAccessoryEnvironment.self]) { [weak self] (observed: UIView, _) in
        self?.syncProminentSearch(using: observed)
      }
    }
    syncProminentSearch(using: targetView, controller: controller)
    return true
  }

  private func syncProminentSearch(using observed: UIView, controller: UITabBarController? = nil) {
    guard #available(iOS 27.0, *), window != nil,
          let controller = controller ?? observedTabBarController ?? findTabBarController() else {
      return
    }
    observedTabBarController = controller
    let isInline = observed.traitCollection.tabAccessoryEnvironment == .inline
    let target: String? = isInline ? controller.tabs.first(where: { $0 is UISearchTab })?.identifier : nil
    guard controller.prominentTabIdentifier != target else { return }
    // Apply synchronously with animations disabled and flush tabBar layout immediately so the
    // newly detached prominent Search platter lands at its minimized 48x48 circle geometry on
    // frame 0 instead of morphing from the expanded 62x62 size with a minimized corner radius.
    Self.applyProminentTab(target, on: controller)
  }

  @available(iOS 27.0, *)
  private static func applyProminentTab(_ identifier: String?, on controller: UITabBarController) {
    UIView.performWithoutAnimation {
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      controller.setProminentTabIdentifier(identifier, animated: false)
      controller.tabBar.setNeedsLayout()
      controller.tabBar.layoutIfNeeded()
      CATransaction.commit()
    }
  }

  private func findTabBarController() -> UITabBarController? {
    var responder: UIResponder? = next
    while let current = responder {
      if let controller = current as? UITabBarController { return controller }
      responder = current.next
    }
    return window?.rootViewController.flatMap(Self.firstTabBarController(in:))
  }

  private static func firstTabBarController(in root: UIViewController) -> UITabBarController? {
    if let controller = root as? UITabBarController { return controller }
    for child in root.children {
      if let controller = firstTabBarController(in: child) { return controller }
    }
    if let presented = root.presentedViewController {
      return firstTabBarController(in: presented)
    }
    return nil
  }
}
