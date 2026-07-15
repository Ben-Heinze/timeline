# Timeline

An interactive, lifelong memory timeline. Timeline ingests your photos, videos,
and audio, reads their EXIF/metadata, and lays your whole life out on a single
zoomable timeline — with a map of where things happened, a Spotify listening
history, journal entries, tags, and groups to organize it all.

Everything runs **locally** on your machine. Your media and the SQLite database
that indexes it never leave your computer.

## Features

- **Zoomable timeline** — a histogram-style canvas spanning years down to
  individual days, backed by fast time-bucketed queries.
- **Media ingest** — imports photos, videos, and audio; extracts EXIF (dates,
  camera, GPS) via ExifTool and generates thumbnails with sharp / ffmpeg.
- **In-app playback** — view photos and play video/audio without leaving the app.
- **Map view** — plots geotagged media on a Leaflet map with a location heatmap.
- **Spotify integration** — imports your listening history and visualizes it by
  year alongside the rest of your timeline.
- **Journal & life events** — attach written entries and mark significant dates.
- **Tags & groups** — organize entries, with a calendar heatmap and search.
- **External drives** — detects removable volumes so a library can span an
  external hard drive; files are referenced in place rather than copied.
- **Backups** — export/restore your library.

## Installation

Download the latest installer for your platform from the
[**Releases page**](https://github.com/Ben-Heinze/timeline/releases).

### Windows
Download `Timeline-Setup-<version>.exe` and run it. On first launch Windows
SmartScreen may show *"Windows protected your PC"* because the app is not
code-signed — click **More info → Run anyway**. (A portable `.zip` is also
provided if you'd rather not install.)

### Linux
- **AppImage** — download `Timeline-<version>.AppImage`, make it executable
  (`chmod +x Timeline-*.AppImage`), and run it. Works on most distributions.
- **Debian/Ubuntu** — download the `.deb` and install with
  `sudo apt install ./Timeline-<version>.deb`.

### macOS
Download the `.dmg` for your Mac — **Apple Silicon** (arm64) or **Intel**
(x64) — and drag Timeline to Applications.

The app is not notarized (no paid Apple Developer account), so on first launch
macOS Gatekeeper will refuse to open it. To allow it:

1. Try to open Timeline once (you'll get a warning), then
2. Open **System Settings → Privacy & Security**, scroll down, and click
   **Open Anyway** next to the Timeline message.

If that doesn't work, remove the quarantine flag from a terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Timeline.app
```

You only need to do this once.

## Development

Timeline is an [Electron](https://www.electronjs.org/) app built with
[electron-vite](https://electron-vite.org/), React, and better-sqlite3.

```bash
npm install
npm run rebuild   # rebuild native modules (better-sqlite3, sharp) against Electron
npm run dev       # launch in development
```

> **NixOS:** use the `justfile` targets (`just install`, `just run`,
> `just rebuild`), which run everything inside `shell.nix` and link the
> Nix-provided Electron binary.

Other useful scripts:

```bash
npm run build     # type-check + bundle to out/
npm test          # Playwright e2e tests
```

## Building installers

Installers must be built on each target OS, so releases are produced by CI
rather than locally. The [release workflow](.github/workflows/release.yml)
builds on Windows, Linux, and macOS in parallel and attaches every installer to
a GitHub Release.

To cut a release:

```bash
# bump "version" in package.json, commit, then tag:
git tag v0.2.0
git push origin v0.2.0
```

Packaging is configured in [`electron-builder.config.js`](electron-builder.config.js):

| OS | Outputs |
| --- | --- |
| Windows | `.exe` (NSIS installer), `.zip` |
| Linux | `.AppImage`, `.deb` |
| macOS | `.dmg` and `.zip` for arm64 + x64 |

Builds are unsigned (Windows) and ad-hoc signed (macOS) — see the installation
notes above for the resulting first-launch prompts.
