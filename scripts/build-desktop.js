#!/usr/bin/env node
// electron-builder can't package @ilovemusic/engine correctly as-is: it's an
// npm workspace symlink (node_modules/@ilovemusic/engine -> ../../packages/engine),
// and electron-builder's file copier preserves a symlinked module root by
// recreating the *same relative link target* in the packaged output (see
// app-builder-lib's copyAppFiles: readlink() + ensureSymlink()) instead of
// dereferencing it. That target (../../packages/engine, relative to the
// packaged node_modules/@ilovemusic dir) does not exist inside the shipped
// .app at all — only main.js/preload.js/renderer/dist and the explicit
// `files` patterns get copied, not the monorepo's packages/ tree. Confirmed
// on a real build via `npx asar list`: @ilovemusic/engine was completely
// absent from the packaged app.asar, not even present as a broken symlink —
// most likely because it also wasn't declared in this file's own
// package.json "dependencies" (fixed alongside this script), so
// electron-builder's dependency-tree walker never considered it at all.
//
// Fix: temporarily replace the workspace symlink with the package's actual
// publishable contents — the same set `npm pack` would use, driven by
// packages/engine's own package.json "files" field ("dist", "scripts") —
// before running electron-builder, then restore the symlink afterward so
// `npm run dev` keeps resolving live-built output through the normal
// workspace link rather than a stale packed snapshot.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const WORKSPACE_NAME = '@ilovemusic/engine';
const WORKSPACE_DIR = path.join(ROOT, 'packages', 'engine');
const NODE_MODULES_PATH = path.join(ROOT, 'node_modules', '@ilovemusic', 'engine');

function packWorkspaceForBuild() {
  const lstat = fs.lstatSync(NODE_MODULES_PATH);
  if (!lstat.isSymbolicLink()) {
    throw new Error(
      `${NODE_MODULES_PATH} is not a symlink (expected the normal npm workspace link — ` +
        `did a previous run fail before restoring it?). Refusing to touch it automatically; ` +
        `investigate, then run \`npm install\` to restore the workspace link before retrying.`
    );
  }

  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilovemusic-pack-'));
  console.log(`[build-desktop] Packing ${WORKSPACE_NAME} (npm pack, respects its own "files" field)...`);
  execFileSync('npm', ['pack', '--silent', '--pack-destination', packDir], { cwd: WORKSPACE_DIR, stdio: 'inherit' });

  const tarball = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack did not produce a .tgz file');

  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilovemusic-extract-'));
  execFileSync('tar', ['-xzf', path.join(packDir, tarball), '-C', extractDir]);

  fs.unlinkSync(NODE_MODULES_PATH);
  fs.renameSync(path.join(extractDir, 'package'), NODE_MODULES_PATH);

  fs.rmSync(packDir, { recursive: true, force: true });
  console.log(`[build-desktop] ${WORKSPACE_NAME} replaced with real files at ${NODE_MODULES_PATH} for this build.`);
}

function restoreWorkspaceSymlink() {
  const relativeTarget = path.relative(path.dirname(NODE_MODULES_PATH), WORKSPACE_DIR);
  if (fs.existsSync(NODE_MODULES_PATH)) {
    fs.rmSync(NODE_MODULES_PATH, { recursive: true, force: true });
  }
  fs.symlinkSync(relativeTarget, NODE_MODULES_PATH, 'dir');
  console.log(`[build-desktop] Restored ${WORKSPACE_NAME} workspace symlink -> ${relativeTarget} (so \`npm run dev\` keeps using live-built output).`);
}

const electronBuilderArgs = process.argv.slice(2);

packWorkspaceForBuild();
let exitCode = 0;
try {
  execFileSync('npx', ['electron-builder', ...electronBuilderArgs], { cwd: ROOT, stdio: 'inherit' });
} catch (err) {
  exitCode = (err && err.status) || 1;
} finally {
  restoreWorkspaceSymlink();
}
process.exit(exitCode);
