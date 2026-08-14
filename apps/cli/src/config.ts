import envPaths from 'env-paths';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// No suffix — env-paths defaults to appending "-nodejs" to avoid clashing
// with native apps of the same name, which doesn't apply here. Resulting
// convention per OS (env-paths, not hand-rolled): macOS
// ~/Library/Preferences/ilovemusic, Linux $XDG_CONFIG_HOME/ilovemusic (or
// ~/.config/ilovemusic), Windows %APPDATA%\ilovemusic\Config.
const paths = envPaths('ilovemusic', { suffix: '' });
const CONFIG_FILE = path.join(paths.config, 'config.json');

export interface CliConfig {
  apiKey: string;
  apiKeyId: string;
  createdAt: string;
  // Local-only cache of "have we successfully PUT Spotify credentials for
  // this key," not a server-verified live status (there's no GET endpoint
  // for that — see api.ts). Deliberately kept dumb: only ever set true
  // right after a successful PUT, and reset via `ilovemusic spotify-logout`
  // if it drifts from the server's actual state (e.g. credentials deleted
  // through another client).
  spotifyCredentialsRegistered?: boolean;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export async function readConfig(): Promise<CliConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(raw) as CliConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  // mode 0o600: best-effort on POSIX (owner read/write only, since this file
  // holds a live API key); Windows ignores POSIX file modes entirely, so
  // this has no effect there — not a security regression, just not
  // applicable on that platform.
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}
