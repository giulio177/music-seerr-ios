// Writes `SceneDelegate.swift` so a React Native root view started in the background by a Shortcut
// (`HeadlessReact`, targets/widget/_shared/Headless.swift) is shown when the app opens, instead of starting a
// second React tree. Without one it behaves exactly like Expo's `ExpoAppSceneDelegate`.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SOURCE = `internal import Expo
import React
import UIKit

// Written by plugins/withHeadlessScene.js.
@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    // React Native already runs without a window (a Shortcut started the app in the background): show that view.
    guard let windowScene = scene as? UIWindowScene,
          let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
          let factory = provider.reactNativeFactory,
          let delegate = factory.delegate,
          let rootView = HeadlessReact.take() else {
      super.scene(scene, willConnectTo: session, options: connectionOptions)
      return
    }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    provider.window = window
    let controller = delegate.createRootViewController()
    delegate.setRootView(rootView, toRootViewController: controller)
    window.rootViewController = controller
    window.makeKeyAndVisible()
    if !connectionOptions.urlContexts.isEmpty {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    }
    connectionOptions.userActivities.forEach { self.scene(scene, continue: $0) }
  }
}
`;

module.exports = function withHeadlessScene(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName, 'SceneDelegate.swift');
      if (!fs.existsSync(file)) throw new Error(`withHeadlessScene: ${file} not found`);
      fs.writeFileSync(file, SOURCE);
      return cfg;
    },
  ]);
};
