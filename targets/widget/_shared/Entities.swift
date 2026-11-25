#if canImport(SystemAudio)
import AppIntents
import CoreSpotlight
import Foundation

// Playlists, albums, and artists for Shortcuts parameters, Siri phrases, and Spotlight. The app's JavaScript writes
// them to `Application Support/MusicSeerr/shortcuts.json` (`src/lib/shortcuts.ts`), so pickers work even when the
// app is not running and the server cannot be reached.

struct CatalogItem: Codable {
  let id: String
  let name: String
  let subtitle: String?
}

struct Catalog: Codable {
  var playlists: [CatalogItem] = []
  var albums: [CatalogItem] = []
  var artists: [CatalogItem] = []

  static func load() -> Catalog {
    guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return Catalog() }
    let url = support.appendingPathComponent("MusicSeerr/shortcuts.json")
    guard let data = try? Data(contentsOf: url), let catalog = try? JSONDecoder().decode(Catalog.self, from: data) else { return Catalog() }
    return catalog
  }
}

@available(iOS 26.0, *)
protocol CatalogEntity: IndexedEntity where ID == String {
  static func items(in catalog: Catalog) -> [CatalogItem]
  init(_ item: CatalogItem)
}

/// Lists for pickers and Siri phrases stay short enough to read; typing a name searches all of them.
private let suggestionLimit = 300

/// Lookups shared by the three queries (concrete query types keep the App Intents metadata simple).
@available(iOS 26.0, *)
enum CatalogSearch {
  static func byID<Entity: CatalogEntity>(_ identifiers: [String]) -> [Entity] {
    let wanted = Set(identifiers)
    return Entity.items(in: .load()).filter { wanted.contains($0.id) }.map(Entity.init)
  }

  static func matching<Entity: CatalogEntity>(_ string: String) -> [Entity] {
    let query = string.trimmingCharacters(in: .whitespacesAndNewlines)
    let items = Entity.items(in: .load())
    guard !query.isEmpty else { return items.prefix(suggestionLimit).map(Entity.init) }
    let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
    // Names that start with the words first, then names that contain them.
    let starts = items.filter { $0.name.range(of: query, options: options.union(.anchored)) != nil }
    let contains = items.filter { $0.name.range(of: query, options: options) != nil && $0.name.range(of: query, options: options.union(.anchored)) == nil }
    return (starts + contains).map(Entity.init)
  }

  static func suggested<Entity: CatalogEntity>() -> [Entity] {
    Entity.items(in: .load()).prefix(suggestionLimit).map(Entity.init)
  }
}

@available(iOS 26.0, *)
struct PlaylistQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [PlaylistEntity] { CatalogSearch.byID(identifiers) }
  func entities(matching string: String) async throws -> [PlaylistEntity] { CatalogSearch.matching(string) }
  func suggestedEntities() async throws -> [PlaylistEntity] { CatalogSearch.suggested() }
}

@available(iOS 26.0, *)
struct AlbumQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [AlbumEntity] { CatalogSearch.byID(identifiers) }
  func entities(matching string: String) async throws -> [AlbumEntity] { CatalogSearch.matching(string) }
  func suggestedEntities() async throws -> [AlbumEntity] { CatalogSearch.suggested() }
}

@available(iOS 26.0, *)
struct ArtistQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [ArtistEntity] { CatalogSearch.byID(identifiers) }
  func entities(matching string: String) async throws -> [ArtistEntity] { CatalogSearch.matching(string) }
  func suggestedEntities() async throws -> [ArtistEntity] { CatalogSearch.suggested() }
}

private func representation(_ name: String, _ subtitle: String?) -> DisplayRepresentation {
  if let subtitle, !subtitle.isEmpty {
    return DisplayRepresentation(title: "\(name)", subtitle: "\(subtitle)")
  }
  return DisplayRepresentation(title: "\(name)")
}

@available(iOS 26.0, *)
struct PlaylistEntity: CatalogEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Playlist")
  static let defaultQuery = PlaylistQuery()

  let id: String
  let name: String
  let subtitle: String?

  init(_ item: CatalogItem) {
    id = item.id
    name = item.name
    subtitle = item.subtitle
  }

  static func items(in catalog: Catalog) -> [CatalogItem] { catalog.playlists }

  var displayRepresentation: DisplayRepresentation { representation(name, subtitle) }
}

@available(iOS 26.0, *)
struct AlbumEntity: CatalogEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Album")
  static let defaultQuery = AlbumQuery()

  let id: String
  let name: String
  let subtitle: String?

  init(_ item: CatalogItem) {
    id = item.id
    name = item.name
    subtitle = item.subtitle
  }

  static func items(in catalog: Catalog) -> [CatalogItem] { catalog.albums }

  var displayRepresentation: DisplayRepresentation { representation(name, subtitle) }
}

@available(iOS 26.0, *)
struct ArtistEntity: CatalogEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Artist")
  static let defaultQuery = ArtistQuery()

  let id: String
  let name: String
  let subtitle: String?

  init(_ item: CatalogItem) {
    id = item.id
    name = item.name
    subtitle = item.subtitle
  }

  static func items(in catalog: Catalog) -> [CatalogItem] { catalog.artists }

  var displayRepresentation: DisplayRepresentation { representation(name, subtitle) }
}

/// What plays now and where, for "What's Playing" (Shortcuts can use each property).
@available(iOS 26.0, *)
struct NowPlayingEntity: TransientAppEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Now Playing")

  @Property(title: "Title") var title: String
  @Property(title: "Artist") var artist: String
  @Property(title: "Album") var album: String
  @Property(title: "Is Playing") var isPlaying: Bool
  @Property(title: "Device") var device: String
  @Property(title: "On This iPhone") var onThisIPhone: Bool
  @Property(title: "On the Web App") var onWebApp: Bool

  init() {
    title = ""
    artist = ""
    album = ""
    isPlaying = false
    device = ""
    onThisIPhone = false
    onWebApp = false
  }

  var displayRepresentation: DisplayRepresentation {
    title.isEmpty ? DisplayRepresentation(title: "Nothing is playing") : representation(title, artist)
  }
}

// MARK: - Options

@available(iOS 26.0, *)
enum SongSelection: String, AppEnum {
  case all
  case downloaded

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Songs")
  static let caseDisplayRepresentations: [SongSelection: DisplayRepresentation] = [
    .all: "All songs",
    .downloaded: "Downloaded songs only",
  ]
}

@available(iOS 26.0, *)
enum RecentSource: String, AppEnum {
  case library
  case downloads

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Source")
  static let caseDisplayRepresentations: [RecentSource: DisplayRepresentation] = [
    .library: "Recently added to the library",
    .downloads: "Recently downloaded",
  ]
}

@available(iOS 26.0, *)
enum PlaybackAction: String, AppEnum {
  case play
  case pause
  case toggle
  case next
  case previous

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Action")
  static let caseDisplayRepresentations: [PlaybackAction: DisplayRepresentation] = [
    .play: "Play",
    .pause: "Pause",
    .toggle: "Play or pause",
    .next: "Next song",
    .previous: "Previous song",
  ]
}

@available(iOS 26.0, *)
enum RepeatOption: String, AppEnum {
  case none
  case all
  case single

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Repeat")
  static let caseDisplayRepresentations: [RepeatOption: DisplayRepresentation] = [
    .none: "Off",
    .all: "All",
    .single: "One",
  ]
}

@available(iOS 26.0, *)
enum QueuePosition: String, AppEnum {
  case next
  case last

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Position")
  static let caseDisplayRepresentations: [QueuePosition: DisplayRepresentation] = [
    .next: "Play next",
    .last: "Play last",
  ]
}

// MARK: - Spotlight and Siri phrases

/// Called from `ShortcutsModule.catalogChanged` (by name, the pod cannot import the app target).
@objc(MusicSeerrIntentsHost)
final class IntentsHost: NSObject {
  @objc static func catalogChanged() {
    guard #available(iOS 26.0, *) else { return }
    Task.detached(priority: .utility) {
      MusicSeerrShortcuts.updateAppShortcutParameters()
      await reindexSpotlight()
    }
  }

  @available(iOS 26.0, *)
  private static func reindexSpotlight() async {
    let catalog = Catalog.load()
    let index = CSSearchableIndex(name: "MusicSeerr")
    do {
      try await index.deleteAllSearchableItems()
      try await index.indexAppEntities(catalog.playlists.map(PlaylistEntity.init))
      try await index.indexAppEntities(catalog.albums.map(AlbumEntity.init))
    } catch {
      NSLog("[shortcuts] Spotlight index failed: \(error)")
    }
  }
}
#endif
