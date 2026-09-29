// Path-restriction logic for the ilovemusic-media:// custom protocol.
//
// Phase 1.5 of ILOVEMUSIC_IMPLEMENTATION_PLAN.md: main.js used to hand the
// renderer raw `file://${track.filePath}` URLs for local audio playback,
// which only worked because `webSecurity: false` was set on the
// BrowserWindow — disabling the renderer's same-origin policy entirely, for
// everything, not just local playback. This module is the actual security
// boundary that replaces it: a custom protocol whose handler will only ever
// serve files that resolve inside one known root directory.
//
// Kept in its own dependency-free module (just node:path/node:url) so the
// path-traversal defense can be unit-tested directly with plain Node,
// without booting Electron — see mediaProtocol.test.js.

const path = require('path');

const SCHEME = 'ilovemusic-media';

// Builds the ilovemusic-media:// URL for a file that is expected to already
// live under mediaRoot. Encodes each path segment individually (not the
// whole relative path with encodeURIComponent, which would also escape the
// '/' separators between directories).
//
// Throws rather than returning a possibly-wrong URL if the file turns out to
// be outside mediaRoot — every current call site in main.js only ever saves
// downloaded tracks under app.getPath('userData')/tracks/, so this should
// never actually trigger; if it does, that's a real bug elsewhere (a file
// landing somewhere unexpected) that deserves a loud failure, not a silently
// broken audio URL.
function toMediaUrl(mediaRoot, absoluteFilePath) {
  const resolvedRoot = path.resolve(mediaRoot);
  const resolvedFile = path.resolve(absoluteFilePath);
  const rel = path.relative(resolvedRoot, resolvedFile);

  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `toMediaUrl: refusing to build a media URL for a path outside the tracks directory: ${absoluteFilePath}`
    );
  }

  const encoded = rel.split(path.sep).map(encodeURIComponent).join('/');
  return `${SCHEME}://media/${encoded}`;
}

// Resolves an incoming ilovemusic-media:// request URL to a real filesystem
// path, or returns null if the request falls outside mediaRoot — including
// when it's been made to, via path traversal.
//
// The check that actually matters happens on the fully-resolved candidate
// path, not on the raw request string: path.resolve() collapses any '..'
// segments (URL-decoded or not) before the containment check runs, so a
// request can't talk its way past a naive prefix check on the un-resolved
// input. This is the only function in this module that a request handler
// should trust to make an allow/deny decision.
function resolveMediaRequestPath(mediaRoot, requestUrl) {
  const resolvedRoot = path.resolve(mediaRoot);

  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${SCHEME}:`) return null;

  let rawPath;
  try {
    rawPath = decodeURIComponent(parsed.pathname || '');
  } catch {
    return null; // malformed percent-encoding
  }
  rawPath = rawPath.replace(/^\/+/, '');

  const candidate = path.resolve(path.join(resolvedRoot, rawPath));

  const isRootItself = candidate === resolvedRoot;
  const isInsideRoot = candidate.startsWith(resolvedRoot + path.sep);
  if (!isRootItself && !isInsideRoot) {
    return null;
  }
  return candidate;
}

module.exports = { SCHEME, toMediaUrl, resolveMediaRequestPath };
