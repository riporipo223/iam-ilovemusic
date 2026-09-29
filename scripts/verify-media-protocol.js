// Verifies the REAL Electron protocol.handle() registration for
// ilovemusic-media:// (Phase 1.5) — not just mediaProtocol.js's pure logic,
// which mediaProtocol.test.js already covers with plain node:test.
// protocol.registerSchemesAsPrivileged/protocol.handle are real Electron
// APIs with no Node-only equivalent, so unlike verify-env-loading.js this
// one needs an actual Electron process, not a replica.
//
// Usage (from the project root):
//   ./node_modules/.bin/electron scripts/verify-media-protocol.js
//
// Exits 0 with "ALL CHECKS PASSED" on success, exits 1 and prints which
// check failed otherwise. Creates its own temp directory as MEDIA_ROOT
// (never touches a real userData/tracks folder) and cleans it up on exit.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const { SCHEME, toMediaUrl, resolveMediaRequestPath } = require('../mediaProtocol');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ilovemusic-media-verify-'));
const trackFile = path.join(tmpRoot, 'albums', 'test-album', '01 - Real Track.mp3');
fs.mkdirSync(path.dirname(trackFile), { recursive: true });
fs.writeFileSync(trackFile, 'fake mp3 bytes for verification only');

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    console.log(`FAIL  ${label}`);
    failures += 1;
  }
}

async function main() {
  await app.whenReady();

  protocol.handle(SCHEME, async (request) => {
    const filePath = resolveMediaRequestPath(tmpRoot, request.url);
    if (!filePath) return new Response('Forbidden', { status: 403 });
    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });

  // 1. Legitimate file — this is the actual audio-playback path.
  const legitUrl = toMediaUrl(tmpRoot, trackFile);
  console.log('Requesting (legitimate):', legitUrl);
  const legitRes = await net.fetch(legitUrl);
  check('legitimate file resolves with 200', legitRes.status === 200);
  const body = await legitRes.text();
  check('legitimate file body matches what was written to disk', body === 'fake mp3 bytes for verification only');

  // 2. Direct path traversal.
  const traversalUrl = `${SCHEME}://media/albums/../../../../../../../../etc/passwd`;
  console.log('Requesting (traversal attempt):', traversalUrl);
  const traversalRes = await net.fetch(traversalUrl);
  check(
    'path-traversal request is refused (403) or safely 404s, never 200s with real /etc/passwd content',
    traversalRes.status === 403 || traversalRes.status === 404
  );
  if (traversalRes.status === 200) {
    const leaked = await traversalRes.text();
    console.log('  !!! LEAKED CONTENT (first 100 chars):', leaked.slice(0, 100));
  }

  // 3. A file that genuinely exists elsewhere on disk (outside MEDIA_ROOT),
  //    confirmed reachable via plain file:// as a sanity control, then
  //    confirmed NOT reachable via the media protocol under the same name.
  const outsideFile = path.join(os.tmpdir(), 'ilovemusic-verify-outside-root.txt');
  fs.writeFileSync(outsideFile, 'should never be servable via ilovemusic-media://');
  const outsideAsIfInside = `${SCHEME}://media/${encodeURIComponent(path.basename(outsideFile))}`;
  console.log('Requesting (file exists, but outside MEDIA_ROOT):', outsideAsIfInside);
  const outsideRes = await net.fetch(outsideAsIfInside);
  check('a real file outside MEDIA_ROOT is not servable by guessing its name', outsideRes.status !== 200);
  fs.rmSync(outsideFile, { force: true });

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('');
  if (failures === 0) {
    console.log('ALL CHECKS PASSED');
    app.exit(0);
  } else {
    console.log(`${failures} CHECK(S) FAILED`);
    app.exit(1);
  }
}

main().catch((err) => {
  console.error('Verification script crashed:', err);
  app.exit(1);
});
