import * as p from '@clack/prompts';
import { deleteSpotifyCredentials } from '../api.js';
import { readConfig, writeConfig } from '../config.js';

/**
 * Resets the local "Spotify credentials registered" flag (see config.ts's
 * spotifyCredentialsRegistered) AND deletes them server-side, so it's a real
 * reset rather than just hiding local drift. Exists specifically because the
 * flag is a local-only cache (Option A from the BYOK-prompt design decision
 * — there's no GET endpoint to verify it live) and can go stale if
 * credentials were registered/removed through another client.
 */
export async function runSpotifyLogout(): Promise<void> {
  p.intro('ILoveMusic — remove Spotify credentials');

  const config = await readConfig();
  if (!config) {
    p.log.error('No API key found. Run `ilovemusic create-api-key` first.');
    process.exitCode = 1;
    return;
  }

  const s = p.spinner();
  s.start('Removing Spotify credentials from the server');
  try {
    await deleteSpotifyCredentials(config.apiKey);
  } catch (err) {
    s.stop('Failed to remove credentials from the server.');
    // Deliberately don't clear the local flag on failure — it would then
    // claim "not registered" while the server still has them, which is the
    // exact drift this command exists to fix, not cause.
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  s.stop('Removed from the server.');

  await writeConfig({ ...config, spotifyCredentialsRegistered: false });
  p.outro('Local record cleared too. The next Spotify download will ask for credentials again.');
}
