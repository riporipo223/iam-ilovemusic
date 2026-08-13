import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * External CLI tools the engine shells out to. Resolution order:
 *   1. `<NAME>_PATH` env var pointing at an exact binary (works anywhere)
 *   2. `ILOVEMUSIC_BIN_DIR` env var + binary name (desktop sets this to its
 *      packaged `resources/bin` dir; a server can point it at a shared bin dir)
 *   3. A few common local dev install locations (macOS Homebrew paths) —
 *      convenience for running the engine straight from a dev machine
 *   4. The bare binary name, resolved via PATH (the expected path on a
 *      server/Docker image where these tools are installed properly)
 */
export type BinaryName = 'spotdl' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'aubio' | 'python3' | 'quickjs';

const ENV_OVERRIDE: Record<BinaryName, string> = {
  spotdl: 'SPOTDL_PATH',
  'yt-dlp': 'YTDLP_PATH',
  ffmpeg: 'FFMPEG_PATH',
  ffprobe: 'FFPROBE_PATH',
  aubio: 'AUBIO_PATH',
  python3: 'PYTHON_PATH',
  quickjs: 'QUICKJS_PATH',
};

const DEV_SEARCH_PATHS: Record<BinaryName, string[]> = {
  spotdl: ['/opt/homebrew/bin/spotdl', '/usr/local/bin/spotdl', '/usr/bin/spotdl'],
  'yt-dlp': ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'],
  ffmpeg: ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'],
  ffprobe: ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'],
  aubio: ['/opt/homebrew/bin/aubio', '/usr/local/bin/aubio', '/usr/bin/aubio'],
  python3: [],
  // No Homebrew formula in common use for quickjs-ng specifically (unlike
  // the other tools above) — ILOVEMUSIC_BIN_DIR (bundled) or bare PATH only.
  quickjs: [],
};

/**
 * On macOS, `pip install --user` (i.e. no venv, system/pyenv Python) drops
 * console scripts under `~/Library/Python/<version>/bin/` — version-specific,
 * so it can't be a static path. Scanned lazily rather than at module load so
 * it costs nothing on platforms/binaries that don't need it.
 */
function findInUserPythonBin(name: string): string | null {
  const base = path.join(os.homedir(), 'Library', 'Python');
  let versions: string[];
  try {
    versions = fs.readdirSync(base);
  } catch {
    return null;
  }

  for (const version of versions) {
    const candidate = path.join(base, version, 'bin', name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveBinary(name: BinaryName): string {
  const envVar = ENV_OVERRIDE[name];
  const fromEnv = envVar ? process.env[envVar] : undefined;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const binDir = process.env.ILOVEMUSIC_BIN_DIR;
  if (binDir) {
    const winExe = process.platform === 'win32' ? '.exe' : '';
    const candidate = path.join(binDir, name + winExe);
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const candidate of DEV_SEARCH_PATHS[name]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === 'darwin') {
    const userBinMatch = findInUserPythonBin(name);
    if (userBinMatch) return userBinMatch;
  }

  return name;
}

/**
 * yt-dlp's `--js-runtimes RUNTIME:PATH` flag, only when a real quickjs
 * binary was actually found (bundled, or on PATH) — omitted otherwise, so
 * yt-dlp falls back to its own default detection (e.g. a system `deno`)
 * rather than being pointed at a nonexistent `quickjs` on a machine that
 * doesn't have one. Extracted here (not inlined at each yt-dlp call site)
 * since resolveBinary('quickjs') already encodes "found vs not" as
 * resolved-path vs bare-name — no need to duplicate that check elsewhere.
 *
 * Needed because YouTube now requires a JS runtime for full extraction
 * (yt-dlp's own announcement: https://github.com/yt-dlp/yt-dlp/issues/15012)
 * — this degrades gracefully rather than hard-failing, but format
 * availability shrinks over time without one. Only relevant for yt-dlp
 * calls that actually hit YouTube; SoundCloud/Bandcamp extraction never
 * touches this, so this helper is deliberately not wired into every
 * yt-dlp call site, only the YouTube-search fallback.
 */
export function ytDlpJsRuntimeArgs(): string[] {
  const quickjsPath = resolveBinary('quickjs');
  if (quickjsPath === 'quickjs') return [];
  return ['--js-runtimes', `quickjs:${quickjsPath}`];
}
