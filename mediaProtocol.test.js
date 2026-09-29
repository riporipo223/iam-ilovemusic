// Plain node:test — no new devDependency for one file. This is the actual
// security boundary for Phase 1.5 (see mediaProtocol.js), so it gets real
// tests rather than being verified only by manual GUI playback.
//
// Run: node --test mediaProtocol.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { SCHEME, toMediaUrl, resolveMediaRequestPath } = require('./mediaProtocol');

// A real temp directory, not a fake in-memory path — path.resolve()'s
// behavior around symlinks/relative segments is exactly what this module
// depends on, so it's worth exercising against a real filesystem.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ilovemusic-media-test-'));
const trackFile = path.join(root, 'albums', 'abc123', '01 - Track.mp3');
fs.mkdirSync(path.dirname(trackFile), { recursive: true });
fs.writeFileSync(trackFile, 'not real audio, just needs to exist');

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// The only unsafe outcome is ever resolving to the REAL target path outside
// root. WHATWG URL parsing already collapses '..' segments (literal and
// percent-encoded) to the URL's own path root before our code sees them —
// confirmed directly: new URL('scheme://host/a/../../../../etc/passwd')
// .pathname is already just '/etc/passwd', clamped, not an escape past
// 'host'. So a request built from a '../'-style traversal attempt lands on
// resolveMediaRequestPath as if it had asked for "etc/passwd" directly:
// that's a safe, real, non-throwing result — root/etc/passwd, contained
// under root, which simply won't exist as a file. Rejecting the REQUEST
// isn't the contract here; never letting it point outside root is.
function assertNeverEscapesRoot(resolved, realTargetOutsideRoot) {
  if (resolved === null) return; // rejecting outright is also safe
  assert.notEqual(resolved, path.resolve(realTargetOutsideRoot));
  assert.equal(
    resolved === path.resolve(root) || resolved.startsWith(path.resolve(root) + path.sep),
    true,
    `resolved path escaped root entirely: ${resolved}`
  );
}

test('toMediaUrl builds a URL under the media scheme for a legitimate file', () => {
  const url = toMediaUrl(root, trackFile);
  assert.equal(url.startsWith(`${SCHEME}://media/`), true);
  assert.match(url, /albums\/abc123\/01%20-%20Track\.mp3$/);
});

test('toMediaUrl throws for a path outside the root', () => {
  const outside = path.join(os.tmpdir(), 'definitely-not-in-root.mp3');
  assert.throws(() => toMediaUrl(root, outside), /refusing to build a media url/i);
});

test('resolveMediaRequestPath resolves a legitimate request back to the real file', () => {
  const url = toMediaUrl(root, trackFile);
  const resolved = resolveMediaRequestPath(root, url);
  assert.equal(resolved, path.resolve(trackFile));
});

test('resolveMediaRequestPath rejects a wrong scheme', () => {
  const resolved = resolveMediaRequestPath(root, 'file:///etc/passwd');
  assert.equal(resolved, null);
});

test('resolveMediaRequestPath rejects an unparseable URL', () => {
  const resolved = resolveMediaRequestPath(root, 'not a url at all');
  assert.equal(resolved, null);
});

test('resolveMediaRequestPath never escapes root for direct path traversal (../../etc/passwd)', () => {
  const malicious = `${SCHEME}://media/albums/../../../../../../etc/passwd`;
  const resolved = resolveMediaRequestPath(root, malicious);
  assertNeverEscapesRoot(resolved, '/etc/passwd');
});

test('resolveMediaRequestPath never escapes root for URL-encoded traversal (%2e%2e)', () => {
  const malicious = `${SCHEME}://media/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd`;
  const resolved = resolveMediaRequestPath(root, malicious);
  assertNeverEscapesRoot(resolved, '/etc/passwd');
});

test('resolveMediaRequestPath never escapes root for double-encoded traversal (%252e%252e)', () => {
  // decodeURIComponent only unwraps one layer, by design — %252e decodes to
  // the literal string "%2e", not to "..", so this lands as a literal
  // (missing) "%2e%2e"-named path, not a silently double-decoded traversal.
  const malicious = `${SCHEME}://media/%252e%252e/%252e%252e/etc/passwd`;
  const resolved = resolveMediaRequestPath(root, malicious);
  assertNeverEscapesRoot(resolved, '/etc/passwd');
});

test('resolveMediaRequestPath rejects an absolute-path escape attempt', () => {
  const malicious = `${SCHEME}://media//etc/passwd`;
  const resolved = resolveMediaRequestPath(root, malicious);
  // Either resolves to root/etc/passwd (still inside root, and simply won't
  // exist) or is rejected — either is safe. The one unsafe outcome would be
  // resolving to the real /etc/passwd, which this asserts against directly.
  assert.notEqual(resolved, path.resolve('/etc/passwd'));
});

test('resolveMediaRequestPath accepts the root itself (empty relative path)', () => {
  const resolved = resolveMediaRequestPath(root, `${SCHEME}://media/`);
  assert.equal(resolved, path.resolve(root));
});

test('round-trip: every real file under root is reachable, nothing outside it is', () => {
  const url = toMediaUrl(root, trackFile);
  assert.equal(fs.existsSync(resolveMediaRequestPath(root, url)), true);

  const traversal = `${SCHEME}://media/../../../../../../../../etc/hosts`;
  const resolved = resolveMediaRequestPath(root, traversal);
  assertNeverEscapesRoot(resolved, '/etc/hosts');
});
