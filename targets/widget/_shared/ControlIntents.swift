import AppIntents
import Foundation

// Actions of the Control Center and Action button controls (Controls.swift in the widget extension). They are built
// into both targets: as audio playback intents the system runs them in the app, where `Bridge` reaches JavaScript.
// Shortcuts lists the full actions of Intents.swift instead, so these stay hidden there.

@available(iOS 26.0, *)
struct TogglePlaybackControlIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Play or Pause"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("control", ["action": "toggle"], from: self)
    return .result()
  }
}

@available(iOS 26.0, *)
struct NextTrackControlIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Next Song"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("control", ["action": "next"], from: self)
    return .result()
  }
}

@available(iOS 26.0, *)
struct PreviousTrackControlIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Previous Song"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("control", ["action": "previous"], from: self)
    return .result()
  }
}

@available(iOS 26.0, *)
struct ShuffleDownloadsControlIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Shuffle Downloads"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("playDownloads", ["shuffle": true], from: self)
    return .result()
  }
}

@available(iOS 26.0, *)
struct ShuffleLibraryControlIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Shuffle Library"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("shuffleLibrary", from: self)
    return .result()
  }
}
