import AppIntents
import Foundation
#if canImport(SystemAudio)
internal import SystemAudio
import UIKit
#endif

// Built into the app and the widget extension. `SystemAudio` (the app's Expo module, with `IntentBridge`) exists
// only in the app, so everything that talks to JavaScript sits behind `canImport(SystemAudio)`.

/// An error Siri and Shortcuts show as is (the text comes localized from JavaScript or the strings files).
struct ShortcutError: Error, CustomLocalizedStringResourceConvertible {
  let message: String
  var localizedStringResource: LocalizedStringResource { "\(message)" }
}

@available(iOS 26.0, *)
enum Bridge {
  /// Runs an action in the app's JavaScript (`src/lib/shortcuts.ts`) and returns its JSON object.
  ///
  /// React Native starts with the scene, so when the app is not running the intent asks to continue in the
  /// foreground first (`supportedModes` of the calling intent must include `.foreground(.dynamic)`).
  static func call(_ action: String, _ args: [String: Any] = [:], from intent: some AppIntent, foreground: Bool = true) async throws -> [String: Any] {
#if canImport(SystemAudio)
    if foreground && !IntentBridge.shared.isReady {
      let active = await MainActor.run { UIApplication.shared.applicationState == .active }
      if !active { try await intent.continueInForeground(nil, alwaysConfirm: false) }
    }
    let data: Data
    do {
      data = try await IntentBridge.shared.call(action, args)
    } catch IntentBridgeError.message(let text) {
      throw ShortcutError(message: text)
    } catch {
      throw ShortcutError(message: String(localized: "Sonalis did not answer. Open the app and try again."))
    }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
#else
    throw ShortcutError(message: String(localized: "Open Sonalis and try again."))
#endif
  }

  /// Runs an action and returns the sentence it answered with (empty when it has nothing to say).
  static func say(_ action: String, _ args: [String: Any] = [:], from intent: some AppIntent) async throws -> String {
    try await call(action, args, from: intent)["text"] as? String ?? ""
  }
}
