#!/usr/bin/env node
// Standalone, Electron-free replica of main.js's dotenv loading logic,
// reporting only PRESENT/MISSING per variable — never the actual value.
//
// Usage:
//   node scripts/verify-env-loading.js            # dev-mode path: __dirname/../.env (project root)
//   node scripts/verify-env-loading.js --packaged  # packaged-mode path: ~/Library/Application Support/ilovemusic-desktop/.env
//
// This mirrors main.js's actual `app.isPackaged ? path.join(app.getPath('userData'), '.env')
// : path.join(__dirname, '.env')` logic without needing a real Electron
// runtime. app.getPath('userData') on macOS is
// ~/Library/Application Support/<app.getName()> — and per Electron's own
// docs, app.getName() prefers a `productName` field over `name` *only if
// productName is present in the package.json Electron actually reads at
// runtime*. electron-builder does NOT inject productName into the packaged
// app.asar's package.json (confirmed: `npx asar extract` on a real build
// and inspected it directly) — it only uses productName for the .app
// bundle name / DMG filename — so app.getName() falls back to "name":
// "ilovemusic-desktop". An earlier pass at this script assumed the
// CFBundleName ("ILoveMusic", from Info.plist) instead, which was wrong and
// caused a false-positive PRESENT result here while the real app looked in
// a different, empty folder. The value below was confirmed against a real
// running instance's actual --user-data-dir launch argument (`ps aux`), not
// re-assumed — if userData naming ever changes (e.g. a future productName
// injected into the packaged package.json, or an explicit app.setName()
// call), this constant needs updating to match, not the other way around.
const PACKAGED_USER_DATA_DIR_NAME = 'ilovemusic-desktop';

const path = require('path');
const os = require('os');

const REQUIRED_VARS = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'ILOVEMUSIC_API_KEY', 'ILOVEMUSIC_API_BASE_URL'];

const packagedMode = process.argv.includes('--packaged');

const dotenvPath = packagedMode
  ? path.join(os.homedir(), 'Library', 'Application Support', PACKAGED_USER_DATA_DIR_NAME, '.env')
  : path.join(__dirname, '..', '.env');

console.log(`Mode: ${packagedMode ? 'packaged (app.getPath("userData")/.env)' : 'dev (__dirname/.env, i.e. project root)'}`);
console.log(`Resolved .env path: ${dotenvPath}`);
console.log('');

const result = require('dotenv').config({ path: dotenvPath, quiet: true });

if (result.error) {
  console.log(`dotenv.config() reported an error: ${result.error.message}`);
} else {
  console.log(`dotenv.config() found and parsed a .env file (${Object.keys(result.parsed || {}).length} vars).`);
}
console.log('');

let allPresent = true;
for (const name of REQUIRED_VARS) {
  const present = typeof process.env[name] === 'string' && process.env[name].length > 0;
  if (!present) allPresent = false;
  console.log(`${name.padEnd(24)} ${present ? 'PRESENT' : 'MISSING'}`);
}

console.log('');
console.log(allPresent ? 'RESULT: all 4 variables loaded successfully.' : 'RESULT: at least one variable failed to load.');
process.exit(allPresent ? 0 : 1);
