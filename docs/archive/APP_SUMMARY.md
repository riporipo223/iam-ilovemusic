# ILoveMusic - Application Summary

## What is ILoveMusic?

ILoveMusic is a desktop music management application built with Electron and React that allows DJs and music enthusiasts to download, organize, and analyze music tracks from SoundCloud and Spotify.

## Core Features

### 1. **Multi-Source Support**
- ✅ SoundCloud tracks
- ✅ Spotify tracks (NEW)
- Automatically detects which service the URL is from

### 2. **Music Download & Conversion**
- Downloads audio in highest quality available
- Converts to MP3 format
- Embeds album artwork
- Adds metadata (title, artist, BPM, key)

### 3. **BPM Detection**
- 3-tier detection system:
  1. Extract from track metadata/tags
  2. Parse audio file metadata
  3. Analyze audio using aubio (signal processing)
- Typical range: 60-200 BPM

### 4. **Music Library Management**
- Search tracks by title, artist, or BPM
- Filter by BPM range
- Sort by title, artist, BPM, or duration
- Select multiple tracks for batch operations
- Edit track metadata

### 5. **Built-in Audio Player**
- Play/pause tracks
- Seek through timeline
- Visual progress bar
- Duration display

### 6. **Artwork Management**
- Downloads album artwork from source
- Embeds artwork into audio file
- Displays artwork in UI (if available)

### 7. **Batch Download**
- Select multiple tracks
- Download as ZIP file to Downloads folder
- Progress indicator

## Technology Stack

### Frontend
- **React** - UI framework
- **Vite** - Build tool and dev server
- **CSS** - Custom styling with modern design

### Backend (Electron Main Process)
- **Electron** - Desktop application framework
- **Node.js** - Runtime environment
- **yt-dlp** - Audio download (YouTube search)
- **ffmpeg** - Audio processing & metadata
- **aubio** - BPM detection
- **music-metadata** - Audio metadata parsing

### APIs
- **Spotify Web API** - Track metadata
  - Client Credentials Flow (no user login needed)
  - Access token caching (50-minute expiry)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Renderer Process                    │
│                 (React + Vite)                       │
│  ┌──────────────────────────────────────────────┐   │
│  │  ILoveMusic.jsx                              │   │
│  │  - UI Components                             │   │
│  │  - State Management                          │   │
│  │  - Audio Playback                            │   │
│  └──────────────────────────────────────────────┘   │
│                       │                              │
│                  IPC Channel                         │
│                  (preload.js)                        │
└─────────────────────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────┐
│                   Main Process                       │
│                    (main.js)                         │
│  ┌──────────────────────────────────────────────┐   │
│  │  IPC Handlers                                │   │
│  │  - soundcloud:add                            │   │
│  │  - downloadTracks                            │   │
│  │  - saveTracks / loadTracks                   │   │
│  └──────────────────────────────────────────────┘   │
│                       │                              │
│         ┌─────────────┼─────────────┐                │
│         ↓             ↓             ↓                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Spotify  │  │ yt-dlp   │  │ ffmpeg   │           │
│  │   API    │  │ Download │  │ Process  │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│                                    ↓                 │
│                              ┌──────────┐            │
│                              │  aubio   │            │
│                              │ BPM Det. │            │
│                              └──────────┘            │
└─────────────────────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────┐
│              File System Storage                     │
│                                                      │
│  ~/Library/Application Support/ilovemusic-desktop/  │
│  ├── tracks/          (Audio files)                 │
│  ├── artwork/         (Album covers)                │
│  └── tracks.json      (Track database)              │
└─────────────────────────────────────────────────────┘
```

## Workflow

### Adding a SoundCloud Track
1. User pastes SoundCloud URL
2. Detect source → `'soundcloud'`
3. yt-dlp fetches track info (title, artist, thumbnail)
4. yt-dlp downloads audio
5. Extract BPM from metadata/tags
6. If no BPM, analyze audio with aubio
7. Download and embed artwork
8. Write metadata to file
9. Add to library

### Adding a Spotify Track
1. User pastes Spotify URL
2. Detect source → `'spotify'`
3. Extract track ID from URL
4. Authenticate with Spotify API (get access token)
5. Fetch metadata (title, artist, duration, album art)
6. Search YouTube: `ytsearch1:{title} {artist} audio`
7. yt-dlp downloads best match
8. Convert to MP3 with ffmpeg
9. Analyze audio with aubio for BPM
10. Download artwork from Spotify
11. Embed artwork and metadata
12. Add to library

### BPM Detection Process
```
Track downloaded
    ↓
Check metadata tags (SoundCloud description, title)
    ↓
If not found → Parse audio file metadata
    ↓
If not found → Convert to WAV (ffmpeg)
    ↓
Run aubio tempo detection
    ↓
Parse output, validate range (60-200 BPM)
    ↓
Store BPM with track
```

## Data Storage

### Track Object Structure
```javascript
{
  id: 1718012345678,           // Timestamp
  title: "Love for Love",      // Track title
  artist: "Robin S",           // Artist name
  duration: 255,               // Seconds
  currentTime: 0,              // Playback position
  url: "file:///path/to.mp3",  // File URL
  filePath: "/absolute/path",  // File path
  bpm: 128,                    // BPM (or null)
  key: "A",                    // Musical key (or null)
  artworkPath: "/path/to.jpg", // Artwork path (or null)
  source: "spotify"            // "soundcloud" or "spotify"
}
```

### File Locations
```
~/Library/Application Support/ilovemusic-desktop/
├── tracks/
│   ├── 1718012345678.mp3
│   ├── 1718012456789.mp3
│   └── ...
├── artwork/
│   ├── 1718012345678.jpg
│   ├── 1718012456789.jpg
│   └── ...
└── tracks.json (track database)
```

## User Interface

### Layout
```
┌────────────────────────────────────────────────────┐
│  [Input: PASTE SOUNDCLOUD OR SPOTIFY URL] [ADD]    │
├────────────────────────────────────────────────────┤
│  [ABOUT] [PREVIEW]                                  │
├────────────────────────────────────────────────────┤
│  Search: [____________] [SELECT ALL]                │
│  BPM: [Min] [Max] Artist: [_______]                │
│  Sort: [Title ▼] [↑ ASC]                            │
├────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐  │
│  │ ▶ Love for Love - Robin S                    │  │
│  │   BPM: 128                                    │  │
│  │   00:45 / 04:15                               │  │
│  │   ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░       │  │
│  │                              [✓] [✏] [🗑]     │  │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │ ⏸ Show Me Love - Robin S                     │  │
│  │   BPM: 126                                    │  │
│  │   02:15 / 03:45                               │  │
│  │   ████████████████████████░░░░░░░░░░░░░░░░   │  │
│  │                              [ ] [✏] [🗑]     │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

### Design Features
- **Background**: Animated video (bg01.mp4)
- **Color Scheme**: Black & white minimal design
- **Font**: SF Mono (monospace)
- **Interactions**: Hover effects, smooth animations
- **Responsiveness**: Fixed 1200x800 window

## Use Cases

### For DJs
1. **Build music library** from SoundCloud/Spotify
2. **Analyze BPM** for beatmatching
3. **Organize tracks** by BPM range
4. **Batch download** for offline use
5. **Edit metadata** for proper library management

### For Music Collectors
1. **Download high-quality audio**
2. **Preserve album artwork**
3. **Organize by artist/BPM**
4. **Search large library**
5. **Play tracks** without opening source website

### For Playlist Curators
1. **Collect tracks** from multiple sources
2. **Filter by BPM** for mood consistency
3. **Export selections** as ZIP
4. **Analyze track characteristics**

## Limitations

### Current Limitations
1. **Spotify Audio Source**: Uses YouTube search (audio quality depends on YouTube)
2. **BPM Accuracy**: ~85-90% accurate (complex tracks may fail)
3. **Rate Limits**: Spotify API has rate limits (cached tokens help)
4. **YouTube Availability**: Track must exist on YouTube for download

### Not Supported
- ❌ Playlists (only single tracks)
- ❌ Albums (only single tracks)
- ❌ Apple Music
- ❌ YouTube Music direct
- ❌ Local file import

## Development

### Project Structure
```
ILoveMusic/
├── main.js                 # Electron main process
├── preload.js              # IPC bridge
├── package.json            # Node dependencies
├── .env                    # Spotify credentials
├── renderer/               # React app
│   ├── src/
│   │   ├── ILoveMusic.jsx  # Main component
│   │   ├── App.jsx         # App wrapper
│   │   ├── main.jsx        # Entry point
│   │   └── assets/         # Images, videos
│   ├── package.json
│   └── vite.config.js
├── build/                  # Build output
└── dist/                   # Distribution packages
```

### Commands
```bash
# Development
npm run dev           # Start dev server + Electron

# Build
npm run build         # Build for all platforms
npm run build:mac     # macOS only
npm run build:win     # Windows only
npm run build:linux   # Linux only

# Testing
node test-spotify.js  # Test Spotify API
```

## Credits

**Made with ❤️ by @cactusdomain**

Built using:
- Electron
- React
- Vite
- yt-dlp
- ffmpeg
- aubio
- Spotify Web API

---

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   cd renderer && npm install && cd ..
   ```

2. **Install tools**:
   ```bash
   brew install ffmpeg yt-dlp aubio
   ```

3. **Configure Spotify** (create `.env`):
   ```env
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   ```

4. **Run**:
   ```bash
   npm run dev
   ```

5. **Add tracks**:
   - Paste SoundCloud or Spotify URL
   - Click "ADD"
   - Wait for download & analysis
   - Track appears in library

Enjoy! 🎵
