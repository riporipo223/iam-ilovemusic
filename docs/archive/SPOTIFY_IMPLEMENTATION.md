# SPOTIFY INTEGRATION - IMPLEMENTATION GUIDE

## OVERVIEW
Add Spotify track support alongside existing SoundCloud functionality.
User dapat paste Spotify track URL dan app akan fetch metadata dari Spotify API,
download audio via yt-dlp, detect BPM, dan embed metadata + artwork.

---

## CHANGES REQUIRED

### 1. ADD DOTENV DEPENDENCY

**File: package.json**
```bash
npm install dotenv
```

### 2. CREATE .env FILE

**File: .env** (di root project, jangan commit!)
```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
```

**Cara dapat credentials:**
1. Buka https://developer.spotify.com/9917becc087144b1a6a3508a9de3d560dashboard
2. Login dengan Spotify account
3. Click "Create an App"
4. Isi nama app (contoh: "ILoveMusic")
5. Copy Client ID dan Client Secret
6. Paste ke file .env

---

## IMPLEMENTATION

### FILE 1: main.js - ADD AT THE TOP (AFTER REQUIRES)

```javascript
// ADD AFTER: const { promisify } = require('util');
require('dotenv').config();
const https = require('https');

// Spotify API credentials
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Store Spotify access token
let spotifyAccessToken = null;
let spotifyTokenExpiry = 0;
```

### FILE 2: main.js - ADD HELPER FUNCTIONS (BEFORE createWindow())

```javascript
// ============================================================================
// SPOTIFY INTEGRATION FUNCTIONS
// ============================================================================

/**
 * Detect URL source (soundcloud, spotify, or unknown)
 */
function detectUrlSource(url) {
  if (!url || typeof url !== 'string') return 'unknown';
  
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('soundcloud.com')) return 'soundcloud';
  if (lowerUrl.includes('open.spotify.com/track/')) return 'spotify';
  
  return 'unknown';
}

/**
 * Extract Spotify track ID from URL
 * Example: https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ?si=xxx
 * Returns: 47iKV0KlcvlflSsrCPD3TQ
 */
function extractSpotifyTrackId(url) {
  const match = url.match(/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Get Spotify access token using Client Credentials Flow
 */
async function getSpotifyAccessToken() {
  // Check if token is still valid
  if (spotifyAccessToken && Date.now() < spotifyTokenExpiry) {
    return spotifyAccessToken;
  }
  
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Spotify credentials not configured. Please add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env file');
  }
  
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const postData = 'grant_type=client_credentials';
    
    const options = {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          const json = JSON.parse(data);
          spotifyAccessToken = json.access_token;
          // Token expires in 1 hour, set expiry to 50 minutes to be safe
          spotifyTokenExpiry = Date.now() + (50 * 60 * 1000);
          resolve(spotifyAccessToken);
        } else {
          reject(new Error(`Spotify auth failed: ${res.statusCode} ${data}`));
        }
      });
    });
    
    req.on('error', (err) => {
      reject(new Error(`Spotify auth request failed: ${err.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch track metadata from Spotify API
 */
async function fetchSpotifyTrackMetadata(trackId) {
  const token = await getSpotifyAccessToken();
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.spotify.com',
      path: `/v1/tracks/${trackId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          const json = JSON.parse(data);
          
          // Extract metadata
          const metadata = {
            id: json.id,
            title: json.name,
            artist: json.artists && json.artists.length > 0 ? json.artists[0].name : 'Unknown Artist',
            // Join all artists if multiple
            allArtists: json.artists ? json.artists.map(a => a.name).join(', ') : 'Unknown Artist',
            duration: Math.round(json.duration_ms / 1000), // Convert to seconds
            thumbnail: null,
            albumName: json.album ? json.album.name : null
          };
          
          // Get largest album cover image
          if (json.album && json.album.images && json.album.images.length > 0) {
            // Images are sorted by size, largest first
            metadata.thumbnail = json.album.images[0].url;
          }
          
          resolve(metadata);
        } else if (res.statusCode === 404) {
          reject(new Error('Spotify track not found'));
        } else {
          reject(new Error(`Spotify API error: ${res.statusCode} ${data}`));
        }
      });
    });
    
    req.on('error', (err) => {
      reject(new Error(`Spotify API request failed: ${err.message}`));
    });
    
    req.end();
  });
}

/**
 * Download audio from YouTube using yt-dlp with search query
 */
async function downloadAudioFromYouTubeSearch(searchQuery, outputPath, trackId) {
  const ytDlpPath = getYtDlpPath();
  
  // Use ytsearch1: prefix to search YouTube and download first result
  const searchUrl = `ytsearch1:${searchQuery} audio`;
  
  console.log('Searching YouTube for:', searchQuery);
  console.log('Search URL:', searchUrl);
  
  const downloadArgs = [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--prefer-ffmpeg',
    '-o', outputPath,
    searchUrl
  ];
  
  try {
    await execFileAsync(ytDlpPath, downloadArgs, { timeout: 120000 }); // 2 minutes timeout
    console.log('Audio downloaded successfully from YouTube');
  } catch (downloadError) {
    // If error with conversion, try without
    if (downloadError.message && (downloadError.message.includes('ffmpeg') || downloadError.message.includes('ffprobe'))) {
      console.log('ffmpeg not found, trying to download original format...');
      const originalArgs = [
        '-x',
        '-f', 'bestaudio',
        '-o', outputPath,
        searchUrl
      ];
      await execFileAsync(ytDlpPath, originalArgs, { timeout: 120000 });
    } else {
      throw downloadError;
    }
  }
}

/**
 * Process Spotify track - main handler
 */
async function processSpotifyTrack(url) {
  console.log('Processing Spotify URL:', url);
  
  // Extract track ID
  const trackId = extractSpotifyTrackId(url);
  if (!trackId) {
    throw new Error('Invalid Spotify URL. Could not extract track ID.');
  }
  
  console.log('Spotify track ID:', trackId);
  
  // Fetch metadata from Spotify API
  console.log('Fetching metadata from Spotify API...');
  const spotifyMetadata = await fetchSpotifyTrackMetadata(trackId);
  console.log('Spotify metadata:', spotifyMetadata);
  
  // Prepare output directory
  const outputDir = path.join(app.getPath('userData'), 'tracks');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Generate unique ID for this track
  const uniqueId = Date.now();
  const outputTemplate = path.join(outputDir, `${uniqueId}.%(ext)s`);
  
  // Delete any existing files with same ID
  const possibleExtensions = ['mp3', 'm4a', 'mp4', 'aac', 'ogg', 'flac', 'opus', 'webm'];
  for (const ext of possibleExtensions) {
    const existingFile = path.join(outputDir, `${uniqueId}.${ext}`);
    if (fs.existsSync(existingFile)) {
      console.log(`Deleting existing file: ${existingFile}`);
      fs.unlinkSync(existingFile);
    }
  }
  
  // Download audio from YouTube using search query
  const searchQuery = `${spotifyMetadata.title} ${spotifyMetadata.artist}`;
  console.log('Downloading audio for:', searchQuery);
  
  await downloadAudioFromYouTubeSearch(searchQuery, outputTemplate, uniqueId);
  
  // Wait for file to be written
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Find downloaded file
  const filesInDir = fs.readdirSync(outputDir);
  const audioExtensions = ['.mp3', '.m4a', '.opus', '.ogg', '.webm', '.flac', '.wav', '.aac'];
  
  let downloadedFile = filesInDir.find(f => 
    f.startsWith(uniqueId.toString()) && 
    audioExtensions.some(ext => f.toLowerCase().endsWith(ext))
  );
  
  if (!downloadedFile) {
    // Try to find most recent file
    const audioFiles = filesInDir
      .filter(f => audioExtensions.some(ext => f.toLowerCase().endsWith(ext)))
      .map(f => ({
        name: f,
        path: path.join(outputDir, f),
        mtime: fs.statSync(path.join(outputDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (audioFiles.length > 0) {
      const recentFile = audioFiles.find(f => Date.now() - f.mtime < 30000);
      if (recentFile) {
        downloadedFile = recentFile.name;
      }
    }
  }
  
  if (!downloadedFile) {
    throw new Error(`Downloaded audio file not found. Tried searching for: ${searchQuery}`);
  }
  
  const filePath = path.join(outputDir, downloadedFile);
  const absolutePath = path.resolve(filePath);
  
  console.log('Audio file downloaded:', absolutePath);
  
  // === BPM DETECTION (same 3-tier as SoundCloud) ===
  let bpm = null;
  let key = null;
  
  try {
    console.log('Detecting BPM for Spotify track...');
    
    // Try to extract from audio file metadata first
    if (mm) {
      try {
        const metadata = await mm.parseFile(absolutePath);
        if (metadata.common.bpm) {
          bpm = Math.round(metadata.common.bpm);
          console.log('BPM found in audio metadata:', bpm);
        }
        
        key = metadata.common.initialKey || metadata.common.key || null;
        if (key) {
          console.log('Key found in audio metadata:', key);
        }
      } catch (mmError) {
        console.log('Error extracting metadata from audio file:', mmError.message);
      }
    }
    
    // If BPM not found, use aubio detection
    if (!bpm) {
      console.log('BPM not in metadata, attempting audio analysis...');
      bpm = await detectBPMFromAudio(absolutePath);
      if (bpm) {
        console.log('BPM detected from audio analysis:', bpm);
      }
    }
    
    console.log('Final BPM:', bpm, 'Key:', key);
  } catch (bpmError) {
    console.log('Error detecting BPM:', bpmError.message);
  }
  
  // === ARTWORK DOWNLOAD ===
  let artworkPath = null;
  
  if (spotifyMetadata.thumbnail) {
    try {
      const artworkDir = path.join(app.getPath('userData'), 'artwork');
      if (!fs.existsSync(artworkDir)) {
        fs.mkdirSync(artworkDir, { recursive: true });
      }
      artworkPath = path.join(artworkDir, `${uniqueId}.jpg`);
      
      console.log('Downloading artwork from:', spotifyMetadata.thumbnail);
      await downloadArtwork(spotifyMetadata.thumbnail, artworkPath);
      console.log('Artwork downloaded successfully');
    } catch (artworkError) {
      console.log('Error downloading artwork:', artworkError.message);
      artworkPath = null;
    }
  }
  
  // === WRITE METADATA & EMBED ARTWORK ===
  try {
    console.log('Writing metadata to file...');
    await writeMetadataToFile(absolutePath, {
      bpm: bpm,
      key: key,
      title: spotifyMetadata.title || 'Unknown',
      artist: spotifyMetadata.allArtists || spotifyMetadata.artist || 'Unknown Artist',
      artworkPath: artworkPath
    });
    console.log('Metadata written successfully');
  } catch (writeError) {
    console.log('Error writing metadata:', writeError.message);
  }
  
  // === RETURN TRACK DATA (same format as SoundCloud) ===
  const trackData = {
    id: uniqueId,
    title: spotifyMetadata.title || 'Unknown',
    artist: spotifyMetadata.allArtists || spotifyMetadata.artist || 'Unknown Artist',
    duration: spotifyMetadata.duration || 0,
    currentTime: 0,
    url: `file://${absolutePath}`,
    filePath: absolutePath,
    bpm: bpm || null,
    key: key || null,
    artworkPath: artworkPath || null,
    source: 'spotify'  // Add source identifier
  };
  
  console.log('Returning Spotify track data:', trackData);
  return trackData;
}
```

### FILE 3: main.js - MODIFY IPC HANDLER (REPLACE EXISTING 'soundcloud:add')

**FIND THIS LINE:**
```javascript
// Handler untuk menambahkan track SoundCloud
ipcMain.handle('soundcloud:add', async (_, url) => {
```

**REPLACE THE ENTIRE HANDLER WITH:**

```javascript
// Handler untuk menambahkan track (SoundCloud atau Spotify)
ipcMain.handle('soundcloud:add', async (_, url) => {
  try {
    // Detect URL source
    const source = detectUrlSource(url);
    console.log('URL source detected:', source);
    
    if (source === 'unknown') {
      throw new Error('Unsupported URL. Please provide a SoundCloud or Spotify track URL.');
    }
    
    // Route to appropriate handler
    if (source === 'spotify') {
      // Process Spotify track
      return await processSpotifyTrack(url);
    } else {
      // Process SoundCloud track (existing flow)
      // Clean URL from unnecessary query parameters
      const cleanUrl = cleanSoundCloudUrl(url);
      if (cleanUrl !== url) {
        console.log('Cleaned URL from:', url);
        console.log('Cleaned URL to:', cleanUrl);
      }
      
      const ytDlpPath = getYtDlpPath();
      console.log('Using yt-dlp at:', ytDlpPath);
      
      const outputDir = path.join(app.getPath('userData'), 'tracks');

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Pertama, dapatkan info track tanpa download
      const infoArgs = [
        '--print-json',
        '--no-download',
        '--flat-playlist',
        '--yes-playlist',
        cleanUrl
      ];

      let info;
      try {
        const { stdout: infoStdout } = await execFileAsync(ytDlpPath, infoArgs);
        info = JSON.parse(infoStdout);
      } catch (infoError) {
        console.error('Error getting track info:', infoError);
        console.error('URL used:', cleanUrl);
        if (infoError.message && infoError.message.includes('JSON')) {
          throw new Error(`Failed to get track information. The URL might be invalid or the track might be unavailable. Original error: ${infoError.message}`);
        } else if (infoError.message && (infoError.message.includes('yt-dlp') || infoError.message.includes('not found'))) {
          throw new Error(`yt-dlp not found or not working. Please ensure yt-dlp is installed and accessible. Original error: ${infoError.message}`);
        } else {
          throw new Error(`Failed to process SoundCloud URL. Please check if the URL is valid and the track is available. Original error: ${infoError.message || infoError}`);
        }
      }

      // ... REST OF SOUNDCLOUD FLOW REMAINS UNCHANGED ...
      // (Keep all existing SoundCloud code here - download, BPM detection, artwork, etc.)
      // I'm not repeating it here to keep this document concise
      // Just ensure you keep everything from the download step onwards
      
      // At the end, add source field:
      const trackData = {
        id: trackId,
        title: info.title || 'Unknown',
        artist: info.uploader || info.channel || 'Unknown Artist',
        duration: info.duration || 0,
        currentTime: 0,
        url: `file://${absolutePath}`,
        filePath: absolutePath,
        bpm: bpm || null,
        key: key || null,
        artworkPath: artworkPath || null,
        source: 'soundcloud'  // ADD THIS LINE
      };
      
      console.log('Returning track data:', trackData);
      return trackData;
    }
  } catch (error) {
    console.error('Error adding track:', error);
    console.error('Error stack:', error.stack);
    const errorMessage = error.message || 'Unknown error occurred';
    throw new Error(`Failed to add track: ${errorMessage}`);
  }
});
```

### FILE 4: renderer/src/ILoveMusic.jsx - CHANGE INPUT PLACEHOLDER

**FIND THIS LINE (around line 759):**
```javascript
placeholder="PASTE SOUNDCLOUD URL"
```

**CHANGE TO:**
```javascript
placeholder="PASTE SOUNDCLOUD OR SPOTIFY URL"  // CHANGED: Support both SoundCloud and Spotify
```

---

## TESTING CHECKLIST

After implementation, test these scenarios:

### ✅ SoundCloud URL (existing functionality)
- [ ] Paste SoundCloud URL → track added
- [ ] BPM detected correctly
- [ ] Artwork embedded
- [ ] Can play/download

### ✅ Spotify URL (new functionality)
- [ ] Paste Spotify URL → track added
- [ ] Metadata (title, artist, duration) correct
- [ ] BPM detected via aubio
- [ ] Artwork downloaded from Spotify album cover
- [ ] Artwork embedded in audio file
- [ ] Can play/download
- [ ] Source field = 'spotify'

### ✅ Error Handling
- [ ] Invalid URL → shows error
- [ ] Missing .env credentials → shows error message
- [ ] Spotify track not found → shows error
- [ ] YouTube search finds no results → shows error

### ✅ Edge Cases
- [ ] Spotify URL with query params (si=xxx) works
- [ ] Long artist names/titles don't break
- [ ] Multiple artists shown correctly
- [ ] Download as ZIP includes both SoundCloud and Spotify tracks

---

## EXAMPLE SPOTIFY URLs FOR TESTING

```
https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp
https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ?si=02de3339cbc54ce8
https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b
```

---

## TROUBLESHOOTING

**Issue: "Spotify credentials not configured"**
- Solution: Create .env file dengan SPOTIFY_CLIENT_ID dan SECRET

**Issue: "Could not find audio for this Spotify track"**
- Solution: yt-dlp tidak bisa find audio di YouTube. Coba track lain atau check internet connection.

**Issue: BPM not detected**
- Solution: Install aubio (`brew install aubio` on macOS)

**Issue: Artwork not embedded**
- Solution: Install ffmpeg (`brew install ffmpeg` on macOS)

---

## NOTES

- Spotify API menggunakan **Client Credentials Flow** (tidak perlu user login)
- Access token di-cache dan auto-refresh setelah 50 menit
- Audio di-download dari YouTube (bukan Spotify langsung, karena Spotify tidak allow direct download)
- yt-dlp search YouTube menggunakan title + artist dari Spotify metadata
- Semua flow setelah download (BPM detection, artwork, metadata) SAMA dengan SoundCloud

---

END OF IMPLEMENTATION GUIDE
