# Troubleshooting Guide - ILoveMusic

## Quick Diagnostics

### Check if all tools are installed:
```bash
which ffmpeg yt-dlp aubio
```

Expected output:
```
/opt/homebrew/bin/ffmpeg
/opt/homebrew/bin/yt-dlp
/opt/homebrew/bin/aubio
```

### Test Spotify credentials:
```bash
node test-spotify-fixed.js
```

Should show:
```
✅ Access token obtained
✅ Track metadata retrieved
✅ All tests passed!
```

## Common Errors

### Error: "ffmpeg is required but not found"

**Symptoms**: Error message when adding tracks
**Cause**: ffmpeg not installed or not in PATH
**Solution**:
```bash
# Install ffmpeg
brew install ffmpeg

# Verify installation
ffmpeg -version
```

### Error: "spawn yt-dlp ENOENT"

**Symptoms**: Error when downloading Spotify tracks
**Cause**: yt-dlp not installed
**Solution**:
```bash
# Install yt-dlp
brew install yt-dlp

# Verify installation
yt-dlp --version
```

### Error: "Spotify credentials not configured"

**Symptoms**: Error when adding Spotify URLs
**Cause**: Missing `.env` file or credentials
**Solution**:
1. Create `.env` file in project root
2. Add credentials:
```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```
3. Restart the application

### Error: "write EPIPE"

**Symptoms**: Random crash with EPIPE error
**Cause**: Network request closed unexpectedly
**Solution**: This should be fixed in the latest code. If it persists:
1. Check your network connection
2. Restart the application
3. Check Electron console for more details

### Error: "Could not find audio for this Spotify track"

**Symptoms**: Spotify track metadata loaded but download failed
**Cause**: Track not available on YouTube
**Solution**: 
- This is a limitation of the current implementation
- Try a different track
- The track must be available on YouTube for audio download

### Error: "BPM detection failed"

**Symptoms**: Track added but BPM shows as null
**Cause**: 
1. aubio not installed
2. Audio file format not supported
3. Track too short or too complex
**Solution**:
```bash
# Install aubio
brew install aubio

# Verify installation
aubio --version
```
If aubio is installed, BPM detection might have failed for this specific track. You can manually edit the BPM in the UI.

## Development Mode Issues

### Electron window shows blank screen

**Cause**: Vite dev server not running
**Solution**:
```bash
# In renderer directory
cd renderer
npm run dev

# In another terminal, run electron
cd ..
npm run dev
```

### Changes not reflecting

**Solution**: Hard reload the Electron window
- Open DevTools: `Cmd + Option + I`
- Right-click reload button → "Empty Cache and Hard Reload"

### Port 5173 already in use

**Cause**: Another Vite server is running
**Solution**:
```bash
# Find and kill the process
lsof -ti:5173 | xargs kill -9

# Restart dev server
cd renderer
npm run dev
```

## Audio File Issues

### Track plays but no sound

**Symptoms**: Track appears to play but no audio
**Cause**: Corrupted download or codec issue
**Solution**:
1. Delete the track from the app
2. Try adding it again
3. Check audio file manually:
```bash
# Find the file
ls -lh ~/Library/Application\ Support/ilovemusic-desktop/tracks/

# Test playback
afplay ~/Library/Application\ Support/ilovemusic-desktop/tracks/[filename].mp3
```

### Artwork not showing

**Symptoms**: Track added but no album art
**Cause**: 
1. Artwork download failed
2. Artwork embedding failed
**Solution**: 
- Check console for artwork-related errors
- Artwork is optional, track should still work

### Metadata not embedded

**Symptoms**: No BPM, title, or artist in audio file
**Cause**: ffmpeg metadata write failed
**Solution**:
- Check ffmpeg installation
- Check file permissions in tracks directory
- Metadata is embedded after download, so UI should still work

## Performance Issues

### Application slow to start

**Cause**: Loading large track library
**Solution**: 
- Track library is stored in `~/Library/Application Support/ilovemusic-desktop/tracks.json`
- If corrupted, delete it (tracks will need to be re-added)

### Download takes too long

**Cause**: 
1. Slow network connection
2. Large audio file
3. yt-dlp searching multiple sources
**Solution**: Wait for download to complete. BPM detection can take 30-60 seconds for some tracks.

## Logs and Debugging

### View Electron logs

**In development**:
- DevTools automatically opens
- Check Console tab

**Check main process logs**:
```bash
# Run from terminal to see main process output
npm run dev
```

### View network requests

1. Open DevTools (`Cmd + Option + I`)
2. Go to Network tab
3. Add a track and watch requests

### Check application data

```bash
# View tracks directory
ls -lh ~/Library/Application\ Support/ilovemusic-desktop/tracks/

# View artwork directory
ls -lh ~/Library/Application\ Support/ilovemusic-desktop/artwork/

# View tracks database
cat ~/Library/Application\ Support/ilovemusic-desktop/tracks.json | jq
```

## Reset Application

### Clear all data

```bash
# Remove application data
rm -rf ~/Library/Application\ Support/ilovemusic-desktop/

# Application will create fresh directories on next run
```

### Reinstall dependencies

```bash
# Root project
rm -rf node_modules package-lock.json
npm install

# Renderer
cd renderer
rm -rf node_modules package-lock.json
npm install
```

## Getting Help

### Check logs for errors
Look for error messages in:
1. Electron DevTools Console
2. Terminal output (main process)
3. Network tab (API errors)

### Report issues
Include:
1. Error message
2. URL you tried to add
3. Electron console output
4. Terminal output
5. Output of diagnostic commands

### Test with example URLs

**SoundCloud test**:
```
https://soundcloud.com/discoveryproject/discovery-project-wuki-3
```

**Spotify test**:
```
https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ
```

If these work, the issue is with specific URLs. If these fail, there's a system-level issue.
