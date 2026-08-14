#!/usr/bin/env node
import { Command } from 'commander';
import { runCreateApiKey } from './commands/createApiKey.js';
import { runDownload } from './commands/download.js';
import { runSpotifyLogout } from './commands/spotifyLogout.js';

const program = new Command();

program
  .name('ilovemusic')
  .description('Interactive CLI for the ILoveMusic public API — download tracks from Spotify, SoundCloud, and Bandcamp')
  .version('0.1.0');

program
  .command('create-api-key')
  .description('Register an API key for yourself and save it locally')
  .action(runCreateApiKey);

program
  .command('download')
  .description('Interactively download a track')
  .action(runDownload);

program
  .command('spotify-logout')
  .description('Remove your registered Spotify credentials (server + local record)')
  .action(runSpotifyLogout);

program.parseAsync(process.argv);
