# Music Seerr for iOS

[![Release](https://img.shields.io/github/v/release/giulio177/music-seerr-ios?sort=semver)](https://github.com/giulio177/music-seerr-ios/releases)
[![iOS build](https://github.com/giulio177/music-seerr-ios/actions/workflows/ios.yml/badge.svg)](https://github.com/giulio177/music-seerr-ios/actions/workflows/ios.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/giulio17)

iPhone client for [Music Seerr](https://github.com/giulio177/music-seerr), the self-hosted music request and playback server for Jellyfin.

> Beta. iOS only (iPhone; no iPad or Android app). Not on the App Store: installed by sideloading with [SideStore](https://sidestore.io) or [AltStore](https://altstore.io) using a free Apple ID.

[Features](#features) · [Requirements](#requirements) · [Install](#install) · [Network](#network) · [Free Apple ID limits](#free-apple-id-limits) · [Siri and Shortcuts](#siri-and-shortcuts) · [Development](#development)

## Features

### Browse and request

- **Sign in** with your Jellyfin account (or as a guest) on your Music Seerr server.
- **Home feed** with recently played tracks, playlists, and Picked for you recommendations.
- **Library browsing** for playlists, artists, albums, songs, and Recently Added albums.
- **Search and request**: preview 30-second catalog clips, request missing songs or albums, and monitor the live server download queue (cancel, retry, or dismiss jobs).
- **Playlist editing**: add tracks to playlists and remove songs from playlists you own.

### Listen and offline

- **Offline downloads**: save songs, albums, and playlists to your iPhone and play them without a connection; downloaded tracks always play from disk even when online.
- **Files app access**: downloads are stored as `<Artist>/<Album>/<NN> <Title>` in the app's Documents folder, visible in the iOS Files app.
- **Offline-first launch**: opens directly into your library, falls back to downloaded songs when the server is unreachable, and supports a downloads-only mode without signing in.
- **Full playback controls**: background audio, lock screen and Control Center controls, editable queue, shuffle, repeat (all or one), and crossfade (1 to 12 seconds).
- **Synced lyrics**: follow along with instrumental break indicators; lyrics are saved offline with every download.
- **Mini player gestures**: swipe left or right on the mini player to skip tracks.

### Synced with the web app

- **Shared playback**: mirror what is playing on the web app, control its queue and playback from your iPhone, or tap **Play on this iPhone** to move audio here.
- **Synced preferences**: accent color and crossfade stay in sync live between web and iOS; changes made offline are sent once the server is reachable again.
- **Admin settings**: Jellyfin administrators can edit server connection settings and artist aliases from the app.

### Native iOS integration

- **Native tab bar** with the mini player as its bottom accessory (iOS 26 and later).
- **System actions**: Siri phrases, Shortcuts actions, Control Center buttons, Action button support, and Spotlight results for playlists and albums (iOS 26 and later).
- **Signature countdown**: **Settings > Signature** shows the days left before your 7-day sideloading signature expires.
- **Languages**: English and Italian.

## Requirements

| Requirement | Details |
| --- | --- |
| Device | iPhone only (no iPad or Android app) |
| iOS | **iOS 26 or later** required for the full experience (tab bar mini player, Siri, Shortcuts, Control Center, Action button, and Spotlight). The IPA declares a minimum of iOS 16.4, so older versions install without those features. |
| Music Seerr server | `v0.9.0` or later for sign-in; `v0.11.1` or later for shared playback, Recently Added, and live synced preferences |
| Sideloading | [SideStore](https://sidestore.io) or [AltStore](https://altstore.io) with a free Apple ID |

## Install

1. Install [SideStore](https://sidestore.io) (recommended: refreshes on-device over Wi-Fi without keeping a computer running) or [AltStore](https://altstore.io) on your iPhone.
2. Add this source in SideStore or AltStore:

   ```
   https://github.com/giulio177/music-seerr-ios/releases/latest/download/altstore-source.json
   ```

3. Install **Music Seerr** from the source.
   - When prompted about app extensions, choose **Keep App Extensions** to enable the Control Center buttons (uses one extra App ID), or skip it to save an App ID.
   - Alternatively, download `MusicSeerr.ipa` from the [latest release](https://github.com/giulio177/music-seerr-ios/releases/latest) and open it in SideStore or AltStore.
4. Open Music Seerr and enter your server address (for example `192.168.1.10:8000`; an `http://` address without a port tries `:8000` automatically).

With a free Apple ID, sideloaded apps expire after 7 days. SideStore and AltStore refresh them in the background, and **Settings > Signature** shows the days remaining.

## Network

- The app connects over plain HTTP on your local network; iOS prompts for **Local Network** access on first use.
- Outside the home network, use a VPN (Tailscale, WireGuard) or put the server behind HTTPS.
- You can change the server address anytime in **Settings** without losing your session if the same server answers there.
- Downloaded songs play without any network connection.

## Free Apple ID limits

| Works | Does not work |
| --- | --- |
| Background audio, lock screen controls, AirPlay, Bluetooth | CarPlay (requires an Apple entitlement) |
| Offline downloads and Files app access | Push notifications |
| Siri phrases naming the app ("Play my downloads in Music Seerr"), Shortcuts, Control Center, Action button, Spotlight | Siri requests without the app name ("Play Road Trip") |

A free Apple ID allows up to 3 active sideloaded apps and 10 App IDs per week. Keeping the Control Center extension uses one extra App ID; the main app works fine without it.

## Siri and Shortcuts

Requires iOS 26 or later.

| Action | What it does |
| --- | --- |
| Play Playlist, Play Album, Play Artist | Asks whether to play all songs or only downloaded ones; optional shuffle |
| Play Downloads, Play Recently Added, Shuffle Library, Play Song | Starts playback |
| Resume Listening, Control Playback, Set Repeat, Set Shuffle | Controls the active device, including the web app |
| Play on This iPhone | Moves playback from the web app to this iPhone |
| Add Song to Queue, Add Album to Queue, Add Current Song to Playlist | Edits the queue or a playlist |
| Request Song, Server Downloads | Requests a song from the catalog or reports active server downloads |
| Download Current Song, Download Album, Download Playlist | Saves songs to the iPhone for offline listening |
| What's Playing | Reports the current song, playback state, and active device |

- If the app is closed, running an action opens it first.
- Playlists and albums are indexed in Spotlight; tapping a result opens the page and starts playback.
- Any action can be assigned to the Action button or used inside Shortcuts automations.

## Development

Built with Expo (React Native).

```bash
npm install
npx expo start          # Metro bundler for the development build
npx tsc --noEmit        # type check
npx expo lint           # lint
```

Because the app includes native modules, Expo Go is not supported:

1. Grab `MusicSeerr-dev.ipa` from a `main` run of the **iOS build** workflow (or trigger the workflow manually with the `development` variant).
2. Install `MusicSeerr-dev.ipa` with SideStore or AltStore.
3. Run `npx expo start` and connect from the app for live JavaScript reloads.

## Builds and releases

`.github/workflows/ios.yml` builds unsigned `.ipa` archives on a macOS runner; SideStore and AltStore sign them on install.

| Trigger | Result |
| --- | --- |
| Push to `main` | Release (`MusicSeerr.ipa`) and development (`MusicSeerr-dev.ipa`) builds as workflow artifacts |
| Pull request | Release build as a workflow artifact |
| Tag `vX.Y.Z` | GitHub release with `MusicSeerr.ipa` and `altstore-source.json` |
| Manual run | Release or development build as a workflow artifact |

Versions follow Semantic Versioning; the git tag is the version source.

## Translations

- Interface strings live in `src/locales/` (`en.json` is the source) and sync with Crowdin via `crowdin.yml`.
- Siri, Shortcuts, and Control Center strings live in `modules/system-audio/ios/Localization/` and `targets/widget/` (`en.lproj` is the source).

## Support

Music Seerr for iOS is free and developed in spare time. If it is useful to you, you can [buy me a coffee](https://buymeacoffee.com/giulio17). Bug reports and feedback in [Issues](https://github.com/giulio177/music-seerr-ios/issues) help just as much.

## Disclaimer

Music Seerr for iOS is beta software built with AI-assisted coding and has received limited validation. Music Seerr is not affiliated with Jellyfin or Apple.

## License

[MIT](LICENSE)
