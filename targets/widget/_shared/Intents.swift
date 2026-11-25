#if canImport(SystemAudio)
import AppIntents
import Foundation

// Shortcuts actions. Each one runs in the app (in the background when the app is running, otherwise it comes
// forward first, see `Bridge.call`) and is carried out by `src/lib/shortcuts.ts`, which answers with the sentence
// Siri says. Parameter pickers read `shortcuts.json` (Entities.swift).

// MARK: - Play

@available(iOS 26.0, *)
struct PlayPlaylistIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Play Playlist"
  static let description = IntentDescription("Plays a playlist, with all its songs or only the downloaded ones.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Playlist", requestValueDialog: "Which playlist?")
  var playlist: PlaylistEntity

  @Parameter(title: "Songs", requestValueDialog: "All songs or only the downloaded ones?")
  var songs: SongSelection

  @Parameter(title: "Shuffle", default: false)
  var shuffle: Bool

  static var parameterSummary: some ParameterSummary {
    Summary("Play \(\.$songs) of \(\.$playlist)") {
      \.$shuffle
    }
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("play", ["kind": "playlist", "id": playlist.id, "downloaded": songs == .downloaded, "shuffle": shuffle], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct PlayAlbumIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Play Album"
  static let description = IntentDescription("Plays an album, with all its songs or only the downloaded ones.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Album", requestValueDialog: "Which album?")
  var album: AlbumEntity

  @Parameter(title: "Songs", requestValueDialog: "All songs or only the downloaded ones?")
  var songs: SongSelection

  @Parameter(title: "Shuffle", default: false)
  var shuffle: Bool

  static var parameterSummary: some ParameterSummary {
    Summary("Play \(\.$songs) of \(\.$album)") {
      \.$shuffle
    }
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("play", ["kind": "album", "id": album.id, "downloaded": songs == .downloaded, "shuffle": shuffle], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct PlayArtistIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Play Artist"
  static let description = IntentDescription("Plays an artist's songs, all of them or only the downloaded ones.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Artist", requestValueDialog: "Which artist?")
  var artist: ArtistEntity

  @Parameter(title: "Songs", requestValueDialog: "All songs or only the downloaded ones?")
  var songs: SongSelection

  @Parameter(title: "Shuffle", default: true)
  var shuffle: Bool

  static var parameterSummary: some ParameterSummary {
    Summary("Play \(\.$songs) of \(\.$artist)") {
      \.$shuffle
    }
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("play", ["kind": "artist", "id": artist.id, "downloaded": songs == .downloaded, "shuffle": shuffle], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct PlayDownloadsIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Play Downloads"
  static let description = IntentDescription("Plays every song downloaded to this iPhone.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Shuffle", default: true)
  var shuffle: Bool

  static var parameterSummary: some ParameterSummary {
    Summary("Play the downloads") {
      \.$shuffle
    }
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("playDownloads", ["shuffle": shuffle], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct PlaySongIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Play Song"
  static let description = IntentDescription("Searches the library for a song and plays the best match.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Song", requestValueDialog: "Which song?")
  var query: String

  static var parameterSummary: some ParameterSummary {
    Summary("Play \(\.$query)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("playSong", ["query": query], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct PlayRecentIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Play Recently Added"
  static let description = IntentDescription("Plays the newest album in the library, or the latest downloads.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Source", default: .library)
  var source: RecentSource

  static var parameterSummary: some ParameterSummary {
    Summary("Play \(\.$source)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("playRecent", ["source": source.rawValue], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct ShuffleLibraryIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Shuffle Library"
  static let description = IntentDescription("Plays a random mix of songs from the whole library.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("shuffleLibrary", from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct ResumeIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Resume Listening"
  static let description = IntentDescription("Continues the last queue from where it stopped.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("resume", from: self)
    return .result(dialog: "\(text)")
  }
}

// MARK: - Control

@available(iOS 26.0, *)
struct PlaybackControlIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Control Playback"
  static let description = IntentDescription("Plays, pauses, or skips, also when the web app is the device playing.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Action", default: .toggle)
  var action: PlaybackAction

  static var parameterSummary: some ParameterSummary {
    Summary("\(\.$action)")
  }

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("control", ["action": action.rawValue], from: self)
    return .result()
  }
}

@available(iOS 26.0, *)
struct PlayHereIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Play on This iPhone"
  static let description = IntentDescription("Moves the playback from the web app to this iPhone.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("playHere", from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct SetRepeatIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Set Repeat"
  static let description = IntentDescription("Repeats nothing, the whole queue, or the current song.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Repeat", default: .all)
  var mode: RepeatOption

  static var parameterSummary: some ParameterSummary {
    Summary("Set repeat to \(\.$mode)")
  }

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("setRepeat", ["mode": mode.rawValue], from: self)
    return .result()
  }
}

@available(iOS 26.0, *)
struct SetShuffleIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Set Shuffle"
  static let description = IntentDescription("Turns shuffle on or off for the current queue.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Shuffle", default: true)
  var on: Bool

  static var parameterSummary: some ParameterSummary {
    Summary("Set shuffle to \(\.$on)")
  }

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("setShuffle", ["on": on], from: self)
    return .result()
  }
}

@available(iOS 26.0, *)
struct QueueSongIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Add Song to Queue"
  static let description = IntentDescription("Searches the library for a song and adds it to the queue.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Song", requestValueDialog: "Which song?")
  var query: String

  @Parameter(title: "Position", default: .next)
  var position: QueuePosition

  static var parameterSummary: some ParameterSummary {
    Summary("Add \(\.$query) to the queue (\(\.$position))")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("queueSong", ["query": query, "next": position == .next], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct QueueAlbumIntent: AudioPlaybackIntent {
  static let title: LocalizedStringResource = "Add Album to Queue"
  static let description = IntentDescription("Adds an album's songs to the queue.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Album", requestValueDialog: "Which album?")
  var album: AlbumEntity

  @Parameter(title: "Position", default: .next)
  var position: QueuePosition

  static var parameterSummary: some ParameterSummary {
    Summary("Add \(\.$album) to the queue (\(\.$position))")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("queueAlbum", ["id": album.id, "next": position == .next], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct NowPlayingIntent: AppIntent {
  static let title: LocalizedStringResource = "What's Playing"
  static let description = IntentDescription("Tells the current song, whether it is playing, and on which device.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult & ReturnsValue<NowPlayingEntity> & ProvidesDialog {
    let result = try await Bridge.call("nowPlaying", from: self)
    var entity = NowPlayingEntity()
    entity.title = result["title"] as? String ?? ""
    entity.artist = result["artist"] as? String ?? ""
    entity.album = result["album"] as? String ?? ""
    entity.isPlaying = result["playing"] as? Bool ?? false
    entity.device = result["device"] as? String ?? ""
    entity.onThisIPhone = result["onThisIPhone"] as? Bool ?? false
    entity.onWebApp = result["onWebApp"] as? Bool ?? false
    let text = result["text"] as? String ?? ""
    return .result(value: entity, dialog: "\(text)")
  }
}

// MARK: - Library and server

@available(iOS 26.0, *)
struct RequestSongIntent: AppIntent {
  static let title: LocalizedStringResource = "Request Song"
  static let description = IntentDescription("Searches the catalog and asks the server to download the best match.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Song", requestValueDialog: "Which song do you want?")
  var query: String

  static var parameterSummary: some ParameterSummary {
    Summary("Request \(\.$query)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("requestSong", ["query": query], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct DownloadQueueIntent: AppIntent {
  static let title: LocalizedStringResource = "Server Downloads"
  static let description = IntentDescription("Tells what the server is downloading and what failed.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    let text = try await Bridge.say("downloadQueue", from: self)
    return .result(value: text, dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct AddToPlaylistIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Current Song to Playlist"
  static let description = IntentDescription("Adds the song playing now to one of your playlists.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Playlist", requestValueDialog: "Which playlist?")
  var playlist: PlaylistEntity

  static var parameterSummary: some ParameterSummary {
    Summary("Add the current song to \(\.$playlist)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("addToPlaylist", ["id": playlist.id], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct DownloadCurrentSongIntent: AppIntent {
  static let title: LocalizedStringResource = "Download Current Song"
  static let description = IntentDescription("Saves the song playing now on this iPhone for offline listening.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("downloadCurrent", from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct DownloadAlbumIntent: AppIntent {
  static let title: LocalizedStringResource = "Download Album"
  static let description = IntentDescription("Saves an album on this iPhone for offline listening.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Album", requestValueDialog: "Which album?")
  var album: AlbumEntity

  static var parameterSummary: some ParameterSummary {
    Summary("Download \(\.$album)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("download", ["kind": "album", "id": album.id], from: self)
    return .result(dialog: "\(text)")
  }
}

@available(iOS 26.0, *)
struct DownloadPlaylistIntent: AppIntent {
  static let title: LocalizedStringResource = "Download Playlist"
  static let description = IntentDescription("Saves a playlist on this iPhone for offline listening.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Playlist", requestValueDialog: "Which playlist?")
  var playlist: PlaylistEntity

  static var parameterSummary: some ParameterSummary {
    Summary("Download \(\.$playlist)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let text = try await Bridge.say("download", ["kind": "playlist", "id": playlist.id], from: self)
    return .result(dialog: "\(text)")
  }
}

// MARK: - Spotlight

/// Spotlight opens a playlist with this: the app shows it and plays it.
@available(iOS 26.0, *)
struct OpenPlaylistIntent: OpenIntent {
  static let title: LocalizedStringResource = "Open Playlist"
  static let description = IntentDescription("Opens a playlist in Music Seerr and plays it.")

  @Parameter(title: "Playlist")
  var target: PlaylistEntity

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("open", ["kind": "playlist", "id": target.id], from: self, foreground: false)
    return .result()
  }
}

/// Spotlight opens an album with this: the app shows it and plays it.
@available(iOS 26.0, *)
struct OpenAlbumIntent: OpenIntent {
  static let title: LocalizedStringResource = "Open Album"
  static let description = IntentDescription("Opens an album in Music Seerr and plays it.")

  @Parameter(title: "Album")
  var target: AlbumEntity

  func perform() async throws -> some IntentResult {
    _ = try await Bridge.call("open", ["kind": "album", "id": target.id], from: self, foreground: false)
    return .result()
  }
}

// MARK: - Siri

/// Phrases Siri knows without setup. Every phrase names the app (required for apps without the Siri entitlement,
/// which a free Apple ID cannot get). Italian phrases are in AppShortcuts.strings.
@available(iOS 26.0, *)
struct MusicSeerrShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: PlayPlaylistIntent(),
      phrases: [
        "Play \(\.$playlist) in \(.applicationName)",
        "Play the playlist \(\.$playlist) in \(.applicationName)",
        "Play a playlist in \(.applicationName)",
      ],
      shortTitle: "Play Playlist",
      systemImageName: "music.note.list"
    )
    AppShortcut(
      intent: PlayAlbumIntent(),
      phrases: [
        "Play the album \(\.$album) in \(.applicationName)",
        "Play an album in \(.applicationName)",
      ],
      shortTitle: "Play Album",
      systemImageName: "square.stack"
    )
    AppShortcut(
      intent: PlayDownloadsIntent(),
      phrases: [
        "Play my downloads in \(.applicationName)",
        "Shuffle my downloads in \(.applicationName)",
      ],
      shortTitle: "Play Downloads",
      systemImageName: "arrow.down.circle"
    )
    AppShortcut(
      intent: PlaySongIntent(),
      phrases: [
        "Play a song in \(.applicationName)",
      ],
      shortTitle: "Play Song",
      systemImageName: "music.note"
    )
    AppShortcut(
      intent: ShuffleLibraryIntent(),
      phrases: [
        "Shuffle my library in \(.applicationName)",
        "Shuffle \(.applicationName)",
      ],
      shortTitle: "Shuffle Library",
      systemImageName: "shuffle"
    )
    AppShortcut(
      intent: PlayRecentIntent(),
      phrases: [
        "Play recently added in \(.applicationName)",
      ],
      shortTitle: "Recently Added",
      systemImageName: "clock"
    )
    AppShortcut(
      intent: ResumeIntent(),
      phrases: [
        "Resume \(.applicationName)",
        "Continue listening in \(.applicationName)",
      ],
      shortTitle: "Resume Listening",
      systemImageName: "play.fill"
    )
    AppShortcut(
      intent: NowPlayingIntent(),
      phrases: [
        "What's playing in \(.applicationName)",
        "What's playing on \(.applicationName)",
      ],
      shortTitle: "What's Playing",
      systemImageName: "waveform"
    )
    AppShortcut(
      intent: RequestSongIntent(),
      phrases: [
        "Request a song in \(.applicationName)",
        "Request a song on \(.applicationName)",
      ],
      shortTitle: "Request Song",
      systemImageName: "plus.circle"
    )
    AppShortcut(
      intent: DownloadQueueIntent(),
      phrases: [
        "What's downloading in \(.applicationName)",
        "Check the downloads in \(.applicationName)",
      ],
      shortTitle: "Server Downloads",
      systemImageName: "tray.and.arrow.down"
    )
  }
}
#endif
