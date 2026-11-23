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
    var groups: [Int: [UIMenuElement]] = [:]
    var order: [Int] = []
    for action in actions {
      let item = UIAction(
        title: action.title,
        image: action.systemImage.flatMap { UIImage(systemName: $0) },
        attributes: action.destructive ? .destructive : []
      ) { [weak self] _ in
        self?.onSelect(["id": action.id])
      }
      if groups[action.group] == nil { order.append(action.group) }
      groups[action.group, default: []].append(item)
    }
    let sections = order.map { UIMenu(title: "", options: .displayInline, children: groups[$0] ?? []) }
    button.menu = UIMenu(title: menuTitle ?? "", children: sections)
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

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    if #available(iOS 27.0, *) {
      registerForTraitChanges([UITraitTabAccessoryEnvironment.self]) { (view: TabBarSearchPinView, _) in
        view.scheduleSync()
      }
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      scheduleSync()
    } else if #available(iOS 27.0, *) {
      let controller = observedTabBarController
      observedTabBarController = nil
      DispatchQueue.main.async {
        guard let controller, controller.bottomAccessory == nil, controller.prominentTabIdentifier != nil else {
          return
        }
        controller.setProminentTabIdentifier(nil, animated: true)
      }
    }
  }

  private func scheduleSync() {
    DispatchQueue.main.async { [weak self] in
      self?.syncProminentSearch()
    }
  }

  private func syncProminentSearch() {
    guard #available(iOS 27.0, *), window != nil, let controller = findTabBarController() else { return }
    observedTabBarController = controller
    let isInline = traitCollection.tabAccessoryEnvironment == .inline
    let target: String? = isInline ? controller.tabs.first(where: { $0 is UISearchTab })?.identifier : nil
    guard controller.prominentTabIdentifier != target else { return }
    controller.setProminentTabIdentifier(target, animated: true)
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
