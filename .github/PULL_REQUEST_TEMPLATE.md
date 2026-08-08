## Description

What changed and why.

## Which part of the project?

- [ ] Desktop app (Electron/React)
- [ ] `packages/engine`
- [ ] `apps/api`
- [ ] Docs/other

## Testing

How you verified this works:

- [ ] `npm test` passes (`packages/engine` + `apps/api`)
- [ ] Tested in dev mode (`npm run dev`) — if touching the desktop app
- [ ] Manually verified the affected download source(s), if touching `packages/engine`/`apps/api` (Spotify/SoundCloud/Bandcamp behave differently — see `CLAUDE.md`)

## Checklist

- [ ] Follows existing code style and patterns
- [ ] No unrelated/drive-by changes bundled in
- [ ] Docs updated if behavior changed
- [ ] If touching the Electron main/preload/renderer boundary: security model preserved (`contextIsolation: true`, no `nodeIntegration`) — see `CONTRIBUTING.md`
