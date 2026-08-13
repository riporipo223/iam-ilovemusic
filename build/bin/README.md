# Bundled binaries

This entire directory is gitignored (`build/bin/` in `.gitignore`) — none of these files are committed to the repo. They're consumed by `electron-builder.yml`'s `extraResources` config, which copies them into the packaged app's `Resources/bin/` at build time. Anyone building this app locally, and any future CI pipeline, needs to place these files here manually before running `npm run build:mac` — **there is currently no fetch script.**

At runtime, the packaged desktop app sets `ILOVEMUSIC_BIN_DIR` to its own `Resources/bin/` (see `main.js`), which `packages/engine/src/binaries.ts`'s `resolveBinary()` checks before falling back to system-installed copies. See `apps/api/README.md`/`DEPLOYMENT.md` for the equivalent story on the API side (same `binaries.ts`, different `ILOVEMUSIC_BIN_DIR` value).

## macOS (`build/bin/`)

| File | Version | Architecture | Source | SHA-256 |
|---|---|---|---|---|
| `yt-dlp` | 2026.07.04 | universal2 (x86_64 + arm64 — confirmed via `file`, an improvement over the previous single-arch build) | Official yt-dlp GitHub release: `https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp_macos` | `498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b` |
| `spotdl` | 4.5.2 | **arm64 only** — confirmed via `file`, not universal2. Their release build script does not pass `--target-arch universal2` and runs on GitHub's arm64 `macos-latest` runner. **Will not run on Intel Macs.** | Official spotDL GitHub release: `https://github.com/spotDL/spotify-downloader/releases/download/v4.5.2/spotdl-4.5.2-darwin` | `0e6a1b704253eda7dda7e85e2a8137b024fdd09cf94e9ab6286350dee95fcabc` |
| `ffmpeg` | 9.0 (evermeet.cx "tessus" build) | **x86_64 only** — evermeet.cx has stated no plans to build for Apple Silicon. Runs on arm64 Macs via Rosetta 2 (verified: `./ffmpeg -version` executes successfully on this arm64 dev machine). | Officially linked from ffmpeg.org's own download page: `https://evermeet.cx/ffmpeg/ffmpeg-9.0.zip` | `b1bd0cbaa0c889a08589dc1d14e4a08eebf425b8726c31a7e270e08552d0f271` (of the `.zip`) |
| `ffprobe` | 9.0 (evermeet.cx "tessus" build) | x86_64 only, same as `ffmpeg` above | `https://evermeet.cx/ffmpeg/ffprobe-9.0.zip` | `66a5102de63ce1c6a203d05a463ac836100eba9403d16968674366de17452da6` (of the `.zip`) |
| `quickjs` | quickjs-ng v0.16.1 (`qjs` binary, renamed) | arm64 only — the arm64 build was chosen since it's the only one this dev machine can verify directly; quickjs-ng also publishes `qjs-darwin-x86_64` if Intel support is needed later | Official quickjs-ng GitHub release: `https://github.com/quickjs-ng/quickjs/releases/download/v0.16.1/qjs-darwin-arm64` | `9a24e7435036906c098d539daf47bcc8e7e8ad2f3aa084a0bce9313c6c3527e0` |

## Windows (`build/bin/win/`)

| File | Notes |
|---|---|
| `yt-dlp.exe` | Currently bundled (pre-existing). Not re-verified this session. |

No `spotdl.exe`/`ffmpeg.exe`/`ffprobe.exe` yet — Windows support is a separate, larger phase (see `CHANGELOG.md`).

## Deliberately NOT bundled: `aubio`

No official static or portable CLI build exists for `aubio` on any platform — checked `aubio/aubio`'s GitHub releases directly (every release from 0.4.2 through 0.4.9 ships source only, zero binary assets). The project's own docs only cover installing the Python module (`pip`/`conda-forge`, which drags in a full Python environment) or an Xcode `.framework` for app projects — neither is a standalone CLI binary suitable for `extraResources`.

This is safe to leave unbundled: `packages/engine/src/processing/bpm.ts`'s `detectBPMFromAudio()` already wraps the `ffmpeg`+`aubio` pipeline in a try/catch and resolves `null` on any failure (missing binary, conversion failure, parse failure) rather than throwing — the same graceful-degradation pattern used for `python3`/`librosa` key detection. A missing `aubio` means the audio-analysis BPM tier never fires; BPM still gets filled in from tags/description/title/embedded metadata when available (the tiers ahead of it in the existing fallback chain).

If bundling `aubio` becomes worth doing later, the realistic options are: compile it from source (real toolchain work, not just a download), or vendor a Homebrew build together with its dylib dependencies (fragile — breaks on Homebrew version drift, not truly static).
