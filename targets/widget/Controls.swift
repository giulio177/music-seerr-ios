import AppIntents
import SwiftUI
import WidgetKit

// Control Center, Lock Screen, and Action button controls. Their intents (_shared/ControlIntents.swift) run in the
// app, which plays the audio.

@main
struct MusicSeerrControls: WidgetBundle {
  var body: some Widget {
    PlayPauseControl()
    NextTrackControl()
    PreviousTrackControl()
    ShuffleDownloadsControl()
    ShuffleLibraryControl()
  }
}

struct PlayPauseControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "io.github.giulio177.musicseerr.control.playpause") {
      ControlWidgetButton(action: TogglePlaybackControlIntent()) {
        Label("Play or Pause", systemImage: "playpause.fill")
      }
    }
    .displayName("Play or Pause")
    .description("Plays or pauses Music Seerr, also when the web app is playing.")
  }
}

struct NextTrackControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "io.github.giulio177.musicseerr.control.next") {
      ControlWidgetButton(action: NextTrackControlIntent()) {
        Label("Next Song", systemImage: "forward.fill")
      }
    }
    .displayName("Next Song")
    .description("Skips to the next song.")
  }
}

struct PreviousTrackControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "io.github.giulio177.musicseerr.control.previous") {
      ControlWidgetButton(action: PreviousTrackControlIntent()) {
        Label("Previous Song", systemImage: "backward.fill")
      }
    }
    .displayName("Previous Song")
    .description("Goes back to the previous song.")
  }
}

struct ShuffleDownloadsControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "io.github.giulio177.musicseerr.control.downloads") {
      ControlWidgetButton(action: ShuffleDownloadsControlIntent()) {
        Label("Shuffle Downloads", systemImage: "arrow.down.circle.fill")
      }
    }
    .displayName("Shuffle Downloads")
    .description("Plays the songs downloaded to this iPhone in random order.")
  }
}

struct ShuffleLibraryControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "io.github.giulio177.musicseerr.control.library") {
      ControlWidgetButton(action: ShuffleLibraryControlIntent()) {
        Label("Shuffle Library", systemImage: "shuffle")
      }
    }
    .displayName("Shuffle Library")
    .description("Plays a random mix of songs from the whole library.")
  }
}
