# Music Seerr for iOS

iOS client for [Music Seerr](https://github.com/giulio177/music-seerr), the self-hosted music request and playback server for Jellyfin.

> Beta. Built with Expo (React Native). Installed by sideloading with AltStore or SideStore; it is not on the App Store.

## Features

- Sign in with your Jellyfin account (or as a guest) on your Music Seerr server.
- Browse playlists, albums, and artists from your Jellyfin library.
- Search the catalog, play 30-second previews, and request songs for the library.
- Download songs, albums, and playlists to the iPhone and play them without the server.
- Background playback, lock screen and Control Center controls, queue, shuffle, and repeat.
- Synced lyrics, also saved with downloads.
- Native iOS tab bar with the mini player as its accessory (iOS 26 and later).
- Siri and Shortcuts actions, Control Center buttons, and Spotlight results for playlists and albums (iOS 26 and later).
- English and Italian interface.

## Requirements

| What | Version |
|---|---|
| iPhone | iOS 16.4 or later (iOS 26 for the mini player in the tab bar) |
| Music Seerr server | A release with native app sign-in (session tokens for the `X-Music-Seerr-Client` header) |
| Sideloading | AltStore or SideStore, a free Apple ID is enough |

## Install

1. Install [AltStore](https://altstore.io) or [SideStore](https://sidestore.io) on the iPhone.
2. Add this source:

   ```
   https://github.com/giulio177/music-seerr-ios/releases/latest/download/altstore-source.json
   ```

3. Install Music Seerr from the source.
   You can also download `MusicSeerr.ipa` from the [latest release](https://github.com/giulio177/music-seerr-ios/releases/latest) and open it in AltStore or SideStore.
4. Open the app and enter your server address (for example `192.168.1.10:8000`).

With a free Apple ID, apps must be refreshed every 7 days. AltStore and SideStore do this in the background.

## Network

- The app talks to the server over plain HTTP on the local network. iOS asks for "Local Network" access on first use.
- Outside the home network, use a VPN (WireGuard, Tailscale) or put the server behind HTTPS.
- Downloaded songs play without any connection.

## Free Apple ID limits

| Works | Does not work |
|---|---|
| Background audio, lock screen controls, AirPlay, Bluetooth | CarPlay (needs an Apple entitlement) |
| Offline downloads | Push notifications |
| Siri phrases that name the app ("Play my downloads in Music Seerr"), Shortcuts, Control Center | Siri requests without the app name ("Play Road Trip") |

The Control Center buttons come from an app extension. On install it takes one more App ID of the free Apple ID's weekly limit.

## Siri and Shortcuts

| Action | What it does |
|---|---|
| Play Playlist, Play Album, Play Artist | Asks whether to play all songs or only the downloaded ones; optional shuffle |
| Play Downloads, Play Recently Added, Shuffle Library, Play Song | Starts playback |
| Resume Listening, Control Playback, Set Repeat, Set Shuffle | Steers the playing device, also the web app |
| Play on This iPhone | Moves the playback from the web app here |
| Add Song to Queue, Add Album to Queue, Add Current Song to Playlist | Edits the queue or a playlist |
| Request Song, Server Downloads | Requests a song from the catalog; tells what the server downloads |
| Download Current Song, Download Album, Download Playlist | Saves songs on the iPhone |
| What's Playing | Returns the song, whether it plays, and on which device |

- When the app is not running, an action opens it first.
- Playlists and albums appear in Spotlight; a result opens the page and plays it.

## Development

```bash
npm install
npx expo start          # Metro bundler for the development build
npx tsc --noEmit        # type check
npx expo lint           # lint
```

The app uses native modules, so Expo Go is not enough:

1. Run the **iOS build** workflow manually with the `development` variant.
2. Install `MusicSeerr-dev.ipa` from the workflow artifacts with AltStore or SideStore.
3. Run `npx expo start` and open the server it prints from the app. JavaScript changes reload live.

## Builds and releases

`.github/workflows/ios.yml` builds an unsigned `.ipa` on a macOS runner; AltStore and SideStore sign it on install.

| Trigger | Result |
|---|---|
| Push to `main`, pull request | Release build as a workflow artifact |
| Tag `vX.Y.Z` | GitHub release with `MusicSeerr.ipa` and `altstore-source.json` |
| Manual run | Release or development build as a workflow artifact |

Versions follow SemVer; the tag is the version source.

## Translations

Interface strings live in `src/locales/` (`en.json` is the source) and sync with Crowdin through `crowdin.yml`.
Siri and Shortcuts strings live in `modules/system-audio/ios/Localization/` and `targets/widget/` (`en.lproj` is the source).

## License

[MIT](LICENSE)
