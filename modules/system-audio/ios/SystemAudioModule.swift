import AVKit
import ExpoModulesCore
import MediaPlayer
import UIKit

/// The system volume slider (MPVolumeView): moves with the hardware buttons and controls the device volume.
public class SystemVolumeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SystemVolume")

    View(SystemVolumeView.self) {
      Prop("minimumTrackColor") { (view: SystemVolumeView, color: UIColor?) in
        view.minimumTrackColor = color
      }
      Prop("maximumTrackColor") { (view: SystemVolumeView, color: UIColor?) in
        view.maximumTrackColor = color
      }
    }
  }
}

final class SystemVolumeView: ExpoView {
  private let volumeView = MPVolumeView(frame: .zero)
  /// Transparent thumb with a comfortable touch size: the track looks like Apple Music's, without a knob.
  private let thumb = UIGraphicsImageRenderer(size: CGSize(width: 28, height: 28)).image { _ in }

  var minimumTrackColor: UIColor? { didSet { styleSlider() } }
  var maximumTrackColor: UIColor? { didSet { styleSlider() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    addSubview(volumeView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    volumeView.frame = bounds
    styleSlider()
  }

  /// MPVolumeView creates its slider lazily, so the style is applied again after each layout.
  private func styleSlider() {
    guard let slider = volumeView.subviews.compactMap({ $0 as? UISlider }).first else { return }
    slider.setThumbImage(thumb, for: .normal)
    slider.setThumbImage(thumb, for: .highlighted)
    if let color = minimumTrackColor { slider.minimumTrackTintColor = color }
    if let color = maximumTrackColor { slider.maximumTrackTintColor = color }
  }
}

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
