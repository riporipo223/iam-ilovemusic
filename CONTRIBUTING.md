# Contributing to ILoveMusic

Thank you for your interest in contributing to ILoveMusic.

Before contributing, understand that this project values:

- **Architectural consistency** - Electron security patterns are non-negotiable
- **Intentional engineering** - Every change should have a clear purpose
- **Long-term maintainability** - Code should be readable and debuggable
- **Understanding before implementation** - Study before modifying

This is NOT a repository for random experimentation.

---

## Required Mindset

Contributors are expected to:

- Understand the project architecture before modifying it
- Respect existing Electron security patterns
- Avoid unnecessary complexity
- Communicate before major changes
- Prioritize maintainability over cleverness

If you are unsure why something exists:

**ASK FIRST.**

Do not rewrite blindly.

---

## AI-Assisted Contributions

AI tools (ChatGPT, Claude, Copilot, Cursor, Windsurf, etc.) are allowed.

However:

- You MUST understand every line submitted
- You MUST review generated output thoroughly
- You MUST ensure consistency with existing architecture
- You MUST explain generated logic if requested
- You MUST test all generated code locally

PRs that appear to be:

- Blindly generated without review
- Structurally inconsistent with existing code
- Architecture-destructive (breaking IPC, security model)
- Dependency-heavy without justification
- Generated without understanding Electron patterns

may be rejected immediately.

---

## Contribution Rules

### DO ✅

- Create focused, single-purpose PRs
- Explain reasoning clearly in PR description
- Maintain existing code patterns and conventions
- Use existing utilities when possible
- Keep code readable and well-commented
- Write meaningful commit messages
- Test locally before submitting
- Follow Electron security best practices
- Ask questions when uncertain

### DO NOT ❌

- Rewrite core structure without discussion
- Rename files/modules unnecessarily
- Introduce large dependencies casually
- Submit massive AI-generated refactors
- Bypass existing conventions
- Change architecture impulsively
- Break Electron security model
- Enable `nodeIntegration` in renderer
- Expose Node.js APIs directly to renderer
- Mix main process logic into renderer

---

## Architecture Guidelines

### Electron Security Model

ILoveMusic follows Electron security best practices:

1. **Context Isolation** - `contextIsolation: true` (NEVER disable)
2. **Node Integration** - `nodeIntegration: false` (NEVER enable)
3. **Preload Scripts** - All IPC communication goes through `preload.js`
4. **Context Bridge** - Use `contextBridge.exposeInMainWorld()` for API exposure

**Example of CORRECT pattern:**

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  downloadTrack: (url) => ipcRenderer.invoke('track:download', url)
});

// renderer (React)
const result = await window.electron.downloadTrack(url);
```

**Example of INCORRECT pattern (NEVER DO THIS):**

```javascript
// ❌ WRONG - Exposes entire Node.js to renderer
webPreferences: {
  nodeIntegration: true,
  contextIsolation: false
}

// ❌ WRONG - Direct require() in renderer
const fs = require('fs'); // Security vulnerability!
```

### IPC Communication Flow

All communication between renderer and main process MUST follow this pattern:

```
Renderer (React) → Preload (contextBridge) → Main Process (IPC Handler)
```

**Adding a new IPC handler:**

1. Define handler in `main.js`:
```javascript
ipcMain.handle('feature:action', async (event, arg) => {
  // Validate input
  // Perform operation
  // Return result
});
```

2. Expose in `preload.js`:
```javascript
contextBridge.exposeInMainWorld('electron', {
  featureAction: (arg) => ipcRenderer.invoke('feature:action', arg)
});
```

3. Use in renderer:
```javascript
const result = await window.electron.featureAction(arg);
```

### File System Operations

- ALL file system operations MUST happen in main process
- NEVER use `fs` directly in renderer
- Always validate file paths to prevent directory traversal
- Use `app.getPath()` for standard directories

### Audio Processing Pipeline

The audio processing flow is:

1. **Download** - via yt-dlp (SoundCloud/Bandcamp) or spotdl with a yt-dlp fallback (Spotify)
2. **Metadata Extraction** - `music-metadata` reads existing tags
3. **BPM Detection** - `aubio` analyzes tempo (via ffmpeg conversion)
4. **Metadata Writing** - `ffmpeg` embeds metadata and artwork
5. **Fallback** - `node-id3` for MP3 if ffmpeg fails

Do not modify this pipeline without understanding each step.

### `packages/engine` and `apps/api`

The download/BPM/metadata logic above is implemented once, in `packages/engine`, and consumed by both `main.js` (Spotify flow only, so far — SoundCloud/Bandcamp still run the original inline `main.js` implementation) and `apps/api` (a separate, unreleased, local-only companion API service; see `apps/api/README.md`).

If you're changing shared logic in `packages/engine`, remember it has **no Electron APIs available** (no `app.getPath()`, no IPC) — it has to stay usable from a plain Node process too. The Electron security model above (context isolation, no `nodeIntegration`, preload bridge) applies to `main.js`/`preload.js`/`renderer/`; it doesn't apply to `packages/engine` or `apps/api`, which aren't renderer-facing at all, but their own boundaries still matter — e.g. `apps/api` never handles a user's Spotify credentials in plaintext outside of the moment it needs to call Spotify's API (see its README's security notes).

---

## Workflow

1. **Fork repository**
2. **Create feature branch** from `main`
3. **Make changes** following guidelines
4. **Test locally** (both dev and production builds)
5. **Commit with clear messages**
6. **Submit Pull Request**

### Branch Naming

```txt
feature/your-feature-name
fix/bug-description
refactor/module-name
docs/documentation-update
```

### Commit Convention

Use clear, descriptive commit messages:

```txt
feat: add playlist export functionality
fix: repair BPM detection for M4A files
refactor: simplify IPC handler structure
docs: update installation instructions
perf: optimize metadata extraction
security: fix path traversal vulnerability
```

---

## Pull Request Guidelines

Every PR MUST contain:

### 1. Clear Description
Explain what changed and why.

### 2. Reason for Change
What problem does this solve? What feature does it add?

### 3. Screenshots/Videos
If UI changes, include visual proof.

### 4. Impact Explanation
How does this affect existing systems?

### 5. Testing Notes
How to verify the change works:
- Steps to reproduce
- Expected behavior
- Test cases covered

### 6. Checklist
- [ ] Tested in development mode (`npm run dev`)
- [ ] Tested in production build (`npm run build:mac/win/linux`)
- [ ] No console errors
- [ ] Follows existing code style
- [ ] Maintains Electron security model
- [ ] Documentation updated (if needed)

### Example PR Template

```markdown
## Description
Adds support for exporting playlists to Rekordbox XML format.

## Motivation
DJs need to import their downloaded tracks into Rekordbox for performance.

## Changes
- Added `exportRekordbox` IPC handler in main.js
- Exposed API in preload.js
- Added "Export to Rekordbox" button in UI
- Implemented XML generation using track metadata

## Testing
1. Add multiple tracks to library
2. Select tracks
3. Click "Export to Rekordbox"
4. Verify XML file is created in Downloads
5. Import XML into Rekordbox to verify format

## Screenshots
[Include screenshot of new button and exported XML]

## Checklist
- [x] Tested in dev mode
- [x] Tested in production build
- [x] No console errors
- [x] Follows existing patterns
- [x] Security model maintained
```

---

## Architecture Safety

The following areas are considered **sensitive** and require extra care:

### Critical Systems

1. **Electron Main Process** - File I/O, system access
2. **Preload Bridge** - Security boundary
3. **IPC Communication** - Data flow between processes
4. **Audio Processing** - ffmpeg/aubio integration
5. **File System Access** - Download paths, user data
6. **Metadata Handling** - Tag writing, artwork embedding

Changes to these systems should be discussed before implementation.

### Security Considerations

- Always validate user input
- Sanitize file paths
- Never execute arbitrary code from renderer
- Use `shell.openExternal()` for external URLs
- Validate IPC message payloads
- Prevent path traversal attacks

---

## Dependency Policy

Avoid adding dependencies unless:

- Absolutely necessary for functionality
- Justified clearly in PR description
- Actively maintained (recent commits)
- Aligned with project philosophy
- No suitable alternative exists

**Before adding a dependency, ask:**
- Can this be implemented with existing dependencies?
- Is this dependency well-maintained?
- What is the bundle size impact?
- Are there security vulnerabilities?
- Does it introduce breaking changes?

Smaller dependency surface = easier maintenance.

---

## Code Style

### JavaScript/React

- Use modern ES6+ syntax
- Prefer `const` over `let`, avoid `var`
- Use async/await over raw Promises
- Keep functions small and focused
- Comment complex logic
- Use descriptive variable names

### File Organization

- Keep related code together
- Separate concerns (UI vs logic)
- Use meaningful file names
- Avoid deeply nested directories

### Error Handling

- Always handle errors gracefully
- Provide user-friendly error messages
- Log errors for debugging
- Never expose internal errors to users

```javascript
// Good
try {
  const result = await window.electron.downloadTrack(url);
  alert('Download successful!');
} catch (err) {
  console.error('Download failed:', err);
  alert('Download failed. Please check the URL and try again.');
}

// Bad
const result = await window.electron.downloadTrack(url); // No error handling
```

---

## Testing

### Manual Testing Checklist

Before submitting a PR, test:

- [ ] Development mode works (`npm run dev`)
- [ ] Production build works (`npm run build`)
- [ ] All existing features still work
- [ ] New feature works as expected
- [ ] No console errors or warnings
- [ ] UI is responsive and accessible
- [ ] Cross-platform compatibility (if possible)

### Testing Audio Features

- Test with various audio formats (MP3, M4A, FLAC)
- Verify BPM detection accuracy
- Check metadata embedding
- Test artwork embedding
- Verify playback functionality

---

## Communication

If you want to:

- Restructure architecture
- Replace major libraries
- Redesign core systems
- Change conventions
- Add significant features

**Open a discussion first.**

Use GitHub Issues or Discussions to propose changes before implementing.

---

## Getting Help

- **Issues** - Report bugs or request features
- **Discussions** - Ask questions or propose ideas
- **Pull Requests** - Submit code changes

Be respectful and constructive in all interactions.

---

## Final Notes

This project is built intentionally with a clear vision.

We welcome contributors who:

- Care about software quality
- Respect architecture decisions
- Value maintainability
- Contribute thoughtfully
- Communicate effectively

Thank you for contributing to ILoveMusic! 🎵

---

## Additional Resources

- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron IPC Tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [React Best Practices](https://react.dev/learn)
- [ffmpeg Documentation](https://ffmpeg.org/documentation.html)
- [aubio Documentation](https://aubio.org/documentation.html)
