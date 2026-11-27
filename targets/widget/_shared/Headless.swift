#if canImport(SystemAudio)
internal import Expo
import React
import UIKit

/// Starts React Native without a window, so Shortcuts and automations work on a locked iPhone.
///
/// React Native normally starts when the scene connects (`ExpoAppSceneDelegate`). An App Intent that launches the
/// app in the background gets no scene, and asking iOS to open the app fails while the iPhone is locked ("The
/// request to open ... failed"). Instead the intent creates the root view here, with no window: the JavaScript runs
/// and answers through `IntentBridge`. When the user opens the app later, `SceneDelegate` (written by
/// `plugins/withHeadlessScene.js`) shows this same view instead of starting a second React tree.
@MainActor
enum HeadlessReact {
  private static var rootView: UIView?

  /// True when JavaScript is running or starting: an existing scene started it, or the root view is created now.
  @discardableResult
  static func startIfNeeded() -> Bool {
    if rootView != nil || UIApplication.shared.connectedScenes.contains(where: { $0 is UIWindowScene }) {
      return true
    }
    guard let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
          let factory = provider.reactNativeFactory else {
      return false
    }
    rootView = factory.rootViewFactory.view(
      withModuleName: provider.reactNativeFactoryModuleName,
      initialProperties: nil,
      launchOptions: nil,
      bundleConfiguration: factory.bundleConfiguration,
      devMenuConfiguration: factory.devMenuConfiguration ?? RCTDevMenuConfiguration.default()
    )
    return true
  }

  /// The root view started in the background, handed over once to the scene that shows it.
  static func take() -> UIView? {
    defer { rootView = nil }
    return rootView
  }
}
#endif
