# ILoveMusic

> Open-source tools for downloading, organizing, and previewing music from SoundCloud, Spotify, and Bandcamp.

ILoveMusic is a small indie project built for DJs, music collectors, and people who genuinely love digging through music. There are three ways to use it:

- **The desktop app** (this repo's root, macOS/Windows/Linux via Electron) — the original, full-featured product: library, playback, artwork, batch downloads.
- **`ilovemusic` CLI** (`@ilovemusic/cli` on npm) — a lightweight, interactive terminal client for people who don't want to install the desktop app. `ilovemusic create-api-key` then `ilovemusic download`. See [apps/cli/README.md](apps/cli/README.md).
- **The public API directly** (self-hosted, live at `api.madebyripo.sbs`) — for anyone who wants to build their own client. See [apps/api/README.md](apps/api/README.md).

The goal is simple:

- download tracks easily
- keep metadata clean
- detect BPM automatically
- organize music faster
- make local music libraries feel good again

Built with Electron, React, ffmpeg, aubio, and a lot of late-night debugging sessions.

---

## Open Source Project

This project is fully open source.

If you want to contribute, improve something, fix bugs, redesign the UI, optimize workflows, or experiment with features — feel free to open a pull request or discussion.

You don't need permission to contribute.

Just:
- understand the project first
- respect the existing structure
- keep things clean and intentional

Small meaningful contributions are always appreciated. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Philosophy

ILoveMusic is intentionally built to stay:

- lightweight
- hackable
- maintainable
- local-first
- simple to understand

This project avoids:
- unnecessary complexity
- overengineered abstractions
- "AI-generated everything" architecture
- bloated dependencies

The codebase is meant to feel approachable for indie developers and contributors.

---

## Stack

- Electron + React + Vite (desktop app)
- ffmpeg, aubio (audio processing, BPM detection)
- spotdl, yt-dlp (downloads)
- music-metadata, node-id3 (tagging)
- TypeScript (`packages/engine`, `apps/api`, `apps/cli`)

---

## Repository structure

```
ILoveMusic/
├── main.js, preload.js, renderer/   # The desktop app
├── packages/engine/                  # Shared download/BPM/metadata engine (TypeScript)
├── apps/api/                         # Public job-based download API — self-hosted, live at api.madebyripo.sbs
├── apps/cli/                         # Interactive CLI client for the public API (@ilovemusic/cli on npm)
└── docs/                             # Technical notes (docs/archive/ = historical, unmaintained)
```

`packages/engine` holds the actual download/processing logic (Spotify, SoundCloud, Bandcamp; BPM and key detection; metadata/artwork embedding) as a shared TypeScript package, used by the desktop app and `apps/api`.

`apps/api` exposes that same engine as a job-based HTTP API (Fastify + a queue worker) for running downloads outside of Electron — self-hosted via Cloudflare Tunnel, live at `api.madebyripo.sbs`. Get your own API key with `POST /v1/api-keys` (or via the CLI below) — see [apps/api/README.md](apps/api/README.md) for the full API and [apps/api/DEPLOYMENT.md](apps/api/DEPLOYMENT.md) if you want to run your own instance.

`apps/cli` is a thin, publishable client over that same public API — `npm install -g @ilovemusic/cli`, then `ilovemusic create-api-key` and `ilovemusic download`, no curl or HTTP needed. See [apps/cli/README.md](apps/cli/README.md).

See [CLAUDE.md](CLAUDE.md) for a deeper technical walkthrough of how each source (Spotify/SoundCloud/Bandcamp) actually works — they're less similar than they look.

---

## Features

- SoundCloud, Spotify, and Bandcamp support
- 320kbps downloads (Spotify, via spotdl)
- Automatic BPM detection
- Artwork embedding
- Metadata editing
- Batch downloads
- Audio preview
- ZIP export
- Cross-platform support

---

## Development

```bash
git clone git@github.com:riporipo223/iam-ilovemusic.git
cd iam-ilovemusic

npm install                     # root workspace: packages/engine + apps/api + apps/cli
npm install --prefix renderer   # renderer has its own lockfile

cp .env.example .env            # add your Spotify Client ID/Secret
npm run dev
```

External tools needed for the desktop app (and `apps/api`'s worker, if you run your own): `ffmpeg`, `aubio`, `spotdl` (Python), `yt-dlp`. `apps/cli` needs none of these — it only talks HTTP to the public API.

---

## Contributing

Contributions are welcome.

Before opening a PR:
- run the project locally
- understand the existing flow
- avoid unnecessary rewrites
- explain your reasoning clearly

This is an evolving indie project, not a corporate framework.

Good ideas are always welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guidelines.

---

## Roadmap

Planned ideas include:

- Rekordbox export
- Playlist/album downloads (currently single-track only)
- Better waveform visualization
- Duplicate detection
- Better library organization tools

---

## License

MIT

---

## Links

- Repository: https://github.com/riporipo223/iam-ilovemusic
- Issues: https://github.com/riporipo223/iam-ilovemusic/issues
