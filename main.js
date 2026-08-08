const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// Load environment variables from .env file
// (quiet: true suppresses dotenv's console "tip" line, which as of v17.4.x
// occasionally advertises an unrelated side project of the maintainer's —
// not something that belongs in this app's console output)
require('dotenv').config({ quiet: true });
const https = require('https');

// Spotify API credentials
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const spotifyCredentials = { clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET };

// Shared download/processing engine (packages/engine) — also consumed by the API server.
// Point it at the packaged app's bundled binaries dir (same convention the
// legacy getYtDlpPath/getFfmpegPath/getAubioPath helpers below still use).
if (app.isPackaged && process.resourcesPath && !process.env.ILOVEMUSIC_BIN_DIR) {
  process.env.ILOVEMUSIC_BIN_DIR = path.join(process.resourcesPath, 'bin');
}
const engine = require('@ilovemusic/engine');

// Store main window reference for progress updates
let mainWindow = null;

// Fix module resolution for unpacked modules in ASAR
if (app.isPackaged && process.resourcesPath) {
  const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked');
  if (fs.existsSync(unpackedPath)) {
    // Add unpacked node_modules to module path
    const unpackedNodeModules = path.join(unpackedPath, 'node_modules');
    if (fs.existsSync(unpackedNodeModules)) {
      // Prepend to module.paths so unpacked modules are found first
      module.paths.unshift(unpackedNodeModules);
      
      // Recursively find and add ALL nested node_modules paths
      const allNodeModulesPaths = [];
      function findAllNodeModules(dir, depth = 0) {
        if (depth > 10) return; // Prevent infinite recursion
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              const nestedPath = path.join(dir, entry.name, 'node_modules');
              if (fs.existsSync(nestedPath)) {
                allNodeModulesPaths.push(nestedPath);
                // Recursively check deeper nesting
                findAllNodeModules(path.join(dir, entry.name), depth + 1);
              }
            }
          }
        } catch (err) {
          // Ignore errors
        }
      }
      findAllNodeModules(unpackedNodeModules);
      
      // Add all found paths to module.paths (prepend so they're checked first)
      for (const p of allNodeModulesPaths) {
        module.paths.unshift(p);
      }
      
      // Patch Module._resolveFilename to handle nested dependencies better
      const Module = require('module');
      const originalResolveFilename = Module._resolveFilename;
      Module._resolveFilename = function(request, parent, isMain, options) {
        try {
          return originalResolveFilename.call(this, request, parent, isMain, options);
        } catch (err) {
          // If module not found, try searching in all unpacked node_modules
          if (err.code === 'MODULE_NOT_FOUND') {
            // Try to find the module in unpacked directories
            for (const nodeModulesPath of [unpackedNodeModules, ...allNodeModulesPaths]) {
              const modulePath = path.join(nodeModulesPath, request);
              if (fs.existsSync(modulePath) || fs.existsSync(modulePath + '.js')) {
                return modulePath;
              }
              // Try with package.json
              const packagePath = path.join(modulePath, 'package.json');
              if (fs.existsSync(packagePath)) {
                const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                const mainFile = pkg.main || 'index.js';
                const mainPath = path.join(modulePath, mainFile);
                if (fs.existsSync(mainPath)) {
                  return mainPath;
                }
              }
            }
          }
          throw err;
        }
      };
      
      console.log('Added', allNodeModulesPaths.length, 'nested node_modules paths for module resolution');
    }
  }
}

// Try to require music-metadata (optional dependency)
let mm = null;
try {
  mm = require('music-metadata');
} catch (e) {
  console.log('music-metadata not available, BPM/Key extraction from audio files will be limited');
}

// Function to detect BPM from audio file using aubio
async function detectBPMFromAudio(filePath) {
  let tempWav = filePath.replace(/\.[^.]+$/, '_temp_bpm.wav');
  let converted = false;
  
  try {
    const ffmpegPath = getFfmpegPath();
    const aubioPath = getAubioPath();
    
    console.log('Using ffmpeg at:', ffmpegPath);
    console.log('Using aubio at:', aubioPath);
    
    // Check if file is already WAV
    if (!filePath.toLowerCase().endsWith('.wav')) {
      console.log('Converting to WAV for BPM detection...');
      // Convert to WAV mono 44.1kHz for better accuracy
      const convertArgs = [
        '-i', filePath,
        '-ar', '44100', // Sample rate
        '-ac', '1', // Mono
        '-f', 'wav',
        '-y',
        tempWav
      ];
      
      await execFileAsync(ffmpegPath, convertArgs, { timeout: 60000 });
      converted = true;
    } else {
      tempWav = filePath; // Use original file if already WAV
    }
    
    // Use aubio tempo to detect BPM
    const aubioArgs = ['tempo', converted ? tempWav : filePath];
    console.log('Running aubio tempo detection...');
    const { stdout, stderr } = await execFileAsync(aubioPath, aubioArgs, { 
      timeout: 120000, // 2 minutes timeout
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    // Parse aubio output - it outputs tempo values
    const output = stdout.toString() + stderr.toString();
    console.log('aubio output:', output);
    
    // aubio tempo outputs values like "120.00 BPM" or just numbers
    const bpmMatches = output.match(/(\d+\.?\d*)\s*(?:bpm|BPM)?/gi);
    if (bpmMatches && bpmMatches.length > 0) {
      // Take the last value (most stable)
      const lastMatch = bpmMatches[bpmMatches.length - 1];
      const bpmValue = parseFloat(lastMatch.match(/(\d+\.?\d*)/)[1]);
      const detectedBPM = Math.round(bpmValue);
      
      // Valid BPM range (typical music is 60-200 BPM)
      if (detectedBPM >= 60 && detectedBPM <= 200) {
        console.log('BPM detected by aubio:', detectedBPM);
        // Clean up temp file
        if (converted && fs.existsSync(tempWav)) {
          fs.unlinkSync(tempWav);
        }
        return detectedBPM;
      } else if (detectedBPM > 0 && detectedBPM < 60) {
        // Sometimes aubio detects half-time, double it
        const doubledBPM = detectedBPM * 2;
        if (doubledBPM >= 60 && doubledBPM <= 200) {
          console.log('BPM detected by aubio (doubled):', doubledBPM);
          // Clean up temp file
          if (converted && fs.existsSync(tempWav)) {
            fs.unlinkSync(tempWav);
          }
          return doubledBPM;
        }
      }
    }
    
    // Clean up temp file
    if (converted && fs.existsSync(tempWav)) {
      fs.unlinkSync(tempWav);
    }
    
    return null;
  } catch (error) {
    console.log('BPM detection failed:', error.message);
    // Clean up temp file if it exists
    if (fs.existsSync(tempWav)) {
      fs.unlinkSync(tempWav);
    }
    return null;
  }
}

// Function to download artwork image
async function downloadArtwork(thumbnailUrl, outputPath) {
  try {
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(thumbnailUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const file = fs.createWriteStream(outputPath);
      
      client.get(thumbnailUrl, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve(outputPath);
          });
        } else if (response.statusCode === 301 || response.statusCode === 302) {
          // Handle redirect
          file.close();
          fs.unlinkSync(outputPath);
          downloadArtwork(response.headers.location, outputPath).then(resolve).catch(reject);
        } else {
          file.close();
          fs.unlinkSync(outputPath);
          reject(new Error(`Failed to download artwork: ${response.statusCode}`));
        }
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        reject(err);
      });
    });
  } catch (error) {
    console.log('Error downloading artwork:', error.message);
    throw error;
  }
}

// Function to embed artwork to audio file
async function embedArtworkToFile(filePath, artworkPath) {
  if (!fs.existsSync(artworkPath)) {
    console.log('Artwork file not found, skipping embed');
    return;
  }
  
  const fileExt = path.extname(filePath).toLowerCase();
  const tempPath = filePath + '.tmp';
  
  try {
    const ffmpegPath = getFfmpegPath();
    console.log('Embedding artwork using ffmpeg...');
    console.log('File extension:', fileExt);
    
    // For M4A/MP4/AAC files, use mp4 format and ensure proper codec settings
    let ffmpegArgs = [];
    
    if (fileExt === '.m4a' || fileExt === '.mp4' || fileExt === '.aac') {
      // For M4A/MP4, use mp4 format with proper codec settings
      ffmpegArgs = [
        '-i', filePath,
        '-i', artworkPath,
        '-map', '0:a', // Map audio stream
        '-map', '1:v', // Map video/image stream
        '-c:a', 'copy', // Copy audio codec (no re-encoding)
        '-c:v', 'mjpeg', // Codec for image
        '-disposition:v', 'attached_pic', // Set image as attached picture
        '-f', 'mp4', // Force mp4 format
        '-y', tempPath
      ];
    } else if (fileExt === '.mp3') {
      // For MP3, use mp3 format
      ffmpegArgs = [
        '-i', filePath,
        '-i', artworkPath,
        '-map', '0:a',
        '-map', '1:v',
        '-c:a', 'copy',
        '-c:v', 'mjpeg',
        '-disposition:v', 'attached_pic',
        '-f', 'mp3',
        '-id3v2_version', '3', // Use ID3v2.3 for better compatibility
        '-y', tempPath
      ];
    } else {
      // For other formats, try without explicit format
      ffmpegArgs = [
        '-i', filePath,
        '-i', artworkPath,
        '-map', '0:a',
        '-map', '1:v',
        '-c:a', 'copy',
        '-c:v', 'mjpeg',
        '-disposition:v', 'attached_pic',
        '-y', tempPath
      ];
    }
    
    console.log('FFmpeg command:', ffmpegPath, ffmpegArgs.join(' '));
    await execFileAsync(ffmpegPath, ffmpegArgs);
    
    // Replace original file with temp file
    fs.renameSync(tempPath, filePath);
    console.log('Artwork embedded successfully using ffmpeg');
  } catch (error) {
    // If ffmpeg fails, try using node-id3 for MP3 files
    if (fileExt === '.mp3') {
      try {
        const NodeID3 = require('node-id3');
        const imageBuffer = fs.readFileSync(artworkPath);
        
        const tags = {
          image: {
            mime: 'image/jpeg',
            type: { id: 3, name: 'front cover' },
            description: 'Cover',
            imageBuffer: imageBuffer
          }
        };
        
        NodeID3.update(tags, filePath);
        console.log('Artwork embedded successfully using node-id3');
        
        // Clean up temp file if it exists
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (id3Error) {
        console.log('Error embedding artwork with node-id3:', id3Error.message);
        // Clean up temp file if it exists
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        // Don't throw error, just log it
      }
    } else {
      // Clean up temp file if it exists
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      // Don't throw error, just log it
      console.log('Error embedding artwork:', error.message);
    }
  }
}

// Function to write metadata to audio file using ffmpeg
async function writeMetadataToFile(filePath, metadata) {
  const fileExt = path.extname(filePath).toLowerCase();
  const tempPath = filePath + '.tmp';
  
  try {
    const ffmpegPath = getFfmpegPath();
    console.log('Using ffmpeg for metadata writing at:', ffmpegPath);
    
    // Use ffmpeg to write metadata
    // For M4A with artwork, we need a specific approach
    const ffmpegArgs = [];
    
    if (metadata.artworkPath && fs.existsSync(metadata.artworkPath) && (fileExt === '.m4a' || fileExt === '.mp4' || fileExt === '.aac')) {
      // Special handling for M4A/MP4 with artwork
      // For M4A, we need a different approach - use loop input for artwork
      
      // Input files - audio first, then artwork (looped to ensure it's treated as video)
      ffmpegArgs.push('-i', filePath);
      ffmpegArgs.push('-loop', '1');
      ffmpegArgs.push('-i', metadata.artworkPath);
      
      // Map streams - audio from input 0, video (artwork) from input 1
      ffmpegArgs.push('-map', '0:a');
      ffmpegArgs.push('-map', '1:v');
      
      // Codecs - copy audio, encode artwork as mjpeg
      ffmpegArgs.push('-c:a', 'copy');
      ffmpegArgs.push('-c:v', 'mjpeg');
      
      // Set artwork as attached picture (critical for M4A/MP4)
      ffmpegArgs.push('-disposition:v', 'attached_pic');
      
      // Remove any existing chapters to avoid conflicts
      ffmpegArgs.push('-map_chapters', '-1');
      
      // Set short duration for artwork (1 frame is enough)
      ffmpegArgs.push('-shortest');
      
      // Metadata for the file
      ffmpegArgs.push('-metadata', `title=${(metadata.title || '').replace(/:/g, '\\:')}`);
      ffmpegArgs.push('-metadata', `artist=${(metadata.artist || '').replace(/:/g, '\\:')}`);
      
      if (metadata.bpm) {
        ffmpegArgs.push('-metadata', `bpm=${Math.round(metadata.bpm)}`);
      }
      
      if (metadata.key) {
        ffmpegArgs.push('-metadata', `initialkey=${metadata.key}`);
      }
      
      // Format and output options for M4A
      // Use mp4 format (M4A is essentially MP4 with audio)
      ffmpegArgs.push('-f', 'mp4');
      ffmpegArgs.push('-movflags', '+faststart');
      // Ensure proper atom structure for M4A
      ffmpegArgs.push('-brand', 'M4A ');
    } else {
      // Standard approach for files without artwork or other formats
      ffmpegArgs.push('-i', filePath);
      
      // Add artwork as second input if provided (for non-M4A formats)
      if (metadata.artworkPath && fs.existsSync(metadata.artworkPath)) {
        ffmpegArgs.push('-i', metadata.artworkPath);
        ffmpegArgs.push('-map', '0:a');
        ffmpegArgs.push('-map', '1');
        ffmpegArgs.push('-c:a', 'copy');
        ffmpegArgs.push('-c:v', 'copy');
        ffmpegArgs.push('-disposition:v', 'attached_pic');
      } else {
        ffmpegArgs.push('-c', 'copy');
      }
      
      // Metadata
      ffmpegArgs.push('-metadata', `title=${(metadata.title || '').replace(/:/g, '\\:')}`);
      ffmpegArgs.push('-metadata', `artist=${(metadata.artist || '').replace(/:/g, '\\:')}`);
      
      if (metadata.bpm) {
        if (fileExt === '.mp3') {
          ffmpegArgs.push('-metadata', `TBPM=${Math.round(metadata.bpm)}`);
        } else {
          ffmpegArgs.push('-metadata', `bpm=${Math.round(metadata.bpm)}`);
        }
      }
      
      if (metadata.key) {
        ffmpegArgs.push('-metadata', `initialkey=${metadata.key}`);
      }
      
      // Format
      if (fileExt === '.mp3') {
        ffmpegArgs.push('-f', 'mp3');
        ffmpegArgs.push('-id3v2_version', '3');
      } else if (fileExt === '.flac') {
        ffmpegArgs.push('-f', 'flac');
      } else if (fileExt === '.ogg' || fileExt === '.oga') {
        ffmpegArgs.push('-f', 'ogg');
      }
    }
    
    // Output to temp file
    ffmpegArgs.push('-y', tempPath); // Overwrite output file
    
    // Log the command for debugging
    console.log('FFmpeg command for metadata:', ffmpegPath, ffmpegArgs.join(' '));
    console.log('Artwork path exists:', metadata.artworkPath ? fs.existsSync(metadata.artworkPath) : 'N/A');
    if (metadata.artworkPath && fs.existsSync(metadata.artworkPath)) {
      const artworkStats = fs.statSync(metadata.artworkPath);
      console.log('Artwork file size:', artworkStats.size, 'bytes');
    }
    
    // Remove temp file if it exists from previous run
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    
    // For M4A with artwork, also check if original file has artwork and remove it first
    if (metadata.artworkPath && fs.existsSync(metadata.artworkPath) && (fileExt === '.m4a' || fileExt === '.mp4' || fileExt === '.aac')) {
      // Check if original file already has artwork stream
      try {
        let ffprobePath = getFfmpegPath().replace('ffmpeg', 'ffprobe');
        if (!fs.existsSync(ffprobePath)) {
          const commonProbePaths = ['ffprobe', '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'];
          for (const probePath of commonProbePaths) {
            if (fs.existsSync(probePath)) {
              ffprobePath = probePath;
              break;
            }
          }
        }
        if (fs.existsSync(ffprobePath)) {
          const probeArgs = ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', filePath];
          const { stdout: probeStdout } = await execFileAsync(ffprobePath, probeArgs);
          if (probeStdout && probeStdout.toString().trim()) {
            console.log('Original file already has artwork stream, will be replaced');
          }
        }
      } catch (probeError) {
        // Ignore probe errors
      }
    }
    
    const { stdout, stderr } = await execFileAsync(ffmpegPath, ffmpegArgs);
    
    // Log output for debugging
    if (stdout) {
      console.log('FFmpeg stdout:', stdout.toString().substring(0, 200));
    }
    if (stderr) {
      const stderrStr = stderr.toString();
      console.log('FFmpeg stderr (first 500 chars):', stderrStr.substring(0, 500));
      // Check for errors in stderr
      if (stderrStr.toLowerCase().includes('error') && !stderrStr.toLowerCase().includes('non-strictly')) {
        console.log('FFmpeg error detected in stderr');
      }
    }
    
    // Verify temp file was created
    if (!fs.existsSync(tempPath)) {
      throw new Error('FFmpeg did not create output file');
    }
    
    const tempStats = fs.statSync(tempPath);
    console.log('Temp file created, size:', tempStats.size, 'bytes');
    
    // Verify original file exists
    if (!fs.existsSync(filePath)) {
      throw new Error('Original file does not exist');
    }
    const originalStats = fs.statSync(filePath);
    console.log('Original file size:', originalStats.size, 'bytes');
    
    // Calculate size difference
    const sizeDiff = tempStats.size - originalStats.size;
    console.log('Size difference (temp - original):', sizeDiff, 'bytes');
    
    if (metadata.artworkPath && fs.existsSync(metadata.artworkPath) && sizeDiff <= 0) {
      console.log('WARNING: File size did not increase after embedding artwork! This may indicate artwork was not embedded.');
      console.log('Artwork file size:', fs.statSync(metadata.artworkPath).size, 'bytes');
    }
    
    // Replace original file with temp file
    // Remove original first to ensure clean overwrite
    console.log('Removing original file before rename...');
    fs.unlinkSync(filePath);
    console.log('Renaming temp file to original...');
    fs.renameSync(tempPath, filePath);
    
    // Verify final file exists and has content
    if (!fs.existsSync(filePath)) {
      throw new Error('Final file does not exist after rename');
    }
    const finalStats = fs.statSync(filePath);
    console.log('Final file size:', finalStats.size, 'bytes');
    
    if (metadata.artworkPath && fs.existsSync(metadata.artworkPath) && finalStats.size <= originalStats.size) {
      console.log('WARNING: Final file size is not larger than original. Artwork may not have been embedded correctly.');
    }
    
    // If artwork was embedded, verify it's in the file
    if (metadata.artworkPath && fs.existsSync(metadata.artworkPath) && (fileExt === '.m4a' || fileExt === '.mp4' || fileExt === '.aac')) {
      try {
        // Use ffprobe to check if artwork is embedded
        let ffprobePath = getFfmpegPath().replace('ffmpeg', 'ffprobe');
        // If replacement didn't work, try common paths
        if (!fs.existsSync(ffprobePath)) {
          const commonProbePaths = [
            'ffprobe',
            '/opt/homebrew/bin/ffprobe',
            '/usr/local/bin/ffprobe',
            '/usr/bin/ffprobe'
          ];
          for (const probePath of commonProbePaths) {
            if (fs.existsSync(probePath)) {
              ffprobePath = probePath;
              break;
            }
          }
        }
        if (fs.existsSync(ffprobePath)) {
          const probeArgs = [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_name',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath
          ];
          try {
            const { stdout: probeStdout } = await execFileAsync(ffprobePath, probeArgs);
            if (probeStdout && probeStdout.toString().trim()) {
              console.log('Artwork stream found in file:', probeStdout.toString().trim());
            } else {
              console.log('WARNING: No artwork stream found in file!');
            }
          } catch (probeError) {
            console.log('Could not verify artwork with ffprobe:', probeError.message);
          }
        }
      } catch (verifyError) {
        console.log('Error verifying artwork:', verifyError.message);
      }
    }
    
    console.log('Metadata written successfully using ffmpeg');
  } catch (error) {
    // If ffmpeg fails, try using node-id3 for MP3 files
    if (fileExt === '.mp3') {
      try {
        const NodeID3 = require('node-id3');
        const tags = {
          title: metadata.title || '',
          artist: metadata.artist || '',
        };
        
        if (metadata.bpm) {
          tags.bpm = Math.round(metadata.bpm).toString();
        }
        
        if (metadata.key) {
          tags.initialKey = metadata.key;
        }
        
        // Add artwork if provided
        if (metadata.artworkPath && fs.existsSync(metadata.artworkPath)) {
          const imageBuffer = fs.readFileSync(metadata.artworkPath);
          tags.image = {
            mime: 'image/jpeg',
            type: { id: 3, name: 'front cover' },
            description: 'Cover',
            imageBuffer: imageBuffer
          };
        }
        
        NodeID3.write(tags, filePath);
        console.log('Metadata written successfully using node-id3');
        
        // Clean up temp file if it exists
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (id3Error) {
        console.log('Error writing metadata with node-id3:', id3Error.message);
        // Clean up temp file if it exists
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        throw id3Error;
      }
    } else {
      // Clean up temp file if it exists
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  }
}

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
  if (lowerUrl.includes('bandcamp.com')) return 'bandcamp';

  return 'unknown';
}

/**
 * Process a Spotify track URL end-to-end via the shared engine package
 * (packages/engine). Desktop-specific concerns (userData paths, IPC progress
 * events, the file:// URL the renderer expects) stay here; the actual
 * download/BPM/key/metadata pipeline lives in the engine so the API server
 * can reuse it verbatim.
 */
async function processSpotifyTrack(url) {
  const outputDir = path.join(app.getPath('userData'), 'tracks');
  const artworkDir = path.join(app.getPath('userData'), 'artwork');

  const track = await engine.processSpotifyTrack(url, {
    outputDir,
    artworkDir,
    spotify: spotifyCredentials,
    // Desktop keeps its existing separate 'enrich-track-metadata' IPC round-trip
    // for key detection, so skip the engine's inline python/librosa fallback here.
    detectKeyFallback: false,
    onProgress: (event) => sendDownloadProgress({ stage: event.stage, message: event.message }),
  });

  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    currentTime: 0,
    url: `file://${track.filePath}`,
    filePath: track.filePath,
    bpm: track.bpm,
    key: track.key,
    artworkPath: track.artworkPath,
    source: track.source,
    downloadSource: track.downloadSource,
    spotifyUrl: track.spotifyUrl,
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200,
    maxWidth: 1200,
    minHeight: 800,
    maxHeight: 800,
    resizable: false,
    fullscreenable: false,
    // macOS specific: Show traffic lights (like Discord)
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  // Prevent fullscreen via keyboard shortcuts
  win.setFullScreenable(false);
  
  // Prevent maximize
  win.setMaximizable(false);
  
  // Prevent minimize (optional, bisa dihapus jika ingin bisa minimize)
  // win.setMinimizable(false);

  // Check if we're in development or production
  // app.isPackaged is true when the app is packaged by electron-builder
  const isDev = !app.isPackaged;
  
  console.log('App is packaged:', app.isPackaged);
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('isDev:', isDev);
  
  if (isDev) {
    // Development mode: Wait for Vite dev server to be ready (max 30 seconds)
    const checkServer = async () => {
      const http = require('http');
      const maxAttempts = 60; // 30 seconds total (60 * 500ms)
      let attempts = 0;
      
      return new Promise((resolve, reject) => {
        const check = () => {
          attempts++;
          const req = http.get('http://localhost:5173', (res) => {
            console.log('Vite dev server is ready!');
            resolve(true);
          });
          
          req.on('error', (err) => {
            if (attempts >= maxAttempts) {
              console.error('Vite dev server not available after 30 seconds');
              reject(err);
            } else {
              setTimeout(check, 500); // Retry after 500ms
            }
          });
          
          req.setTimeout(1000, () => {
            req.destroy();
            if (attempts >= maxAttempts) {
              reject(new Error('Timeout waiting for Vite server'));
            } else {
              setTimeout(check, 500);
            }
          });
        };
        check();
      });
    };

    // Load URL after server is ready
    checkServer()
      .then(() => {
        console.log('Loading http://localhost:5173');
        win.loadURL('http://localhost:5173');
      })
      .catch((err) => {
        console.error('Failed to connect to Vite dev server:', err);
        console.log('Attempting to load anyway...');
        win.loadURL('http://localhost:5173');
      });
    
    // Open DevTools for debugging in development
    win.webContents.openDevTools();
    
    // Handle errors
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Failed to load:', errorCode, errorDescription);
      if (errorCode === -106) {
        // ERR_INTERNET_DISCONNECTED or similar
        setTimeout(() => {
          win.loadURL('http://localhost:5173');
        }, 1000);
      }
    });
  } else {
    // Production mode: Load from file system
    // In packaged app, renderer/dist is in extraResources at app/dist
    console.log('Production mode detected');
    console.log('process.resourcesPath:', process.resourcesPath);
    console.log('__dirname:', __dirname);
    console.log('app.getAppPath():', app.getAppPath());
    
    // Try multiple possible paths
    let indexPath = path.join(process.resourcesPath, 'app', 'dist', 'index.html');
    console.log('Trying path 1:', indexPath, 'exists:', fs.existsSync(indexPath));
    
    if (!fs.existsSync(indexPath)) {
      // Fallback: try relative to __dirname
      indexPath = path.join(__dirname, '..', 'app', 'dist', 'index.html');
      console.log('Trying path 2:', indexPath, 'exists:', fs.existsSync(indexPath));
    }
    if (!fs.existsSync(indexPath)) {
      // Another fallback: try in app.getAppPath()
      indexPath = path.join(app.getAppPath(), 'app', 'dist', 'index.html');
      console.log('Trying path 3:', indexPath, 'exists:', fs.existsSync(indexPath));
    }
    if (!fs.existsSync(indexPath)) {
      // Last fallback: try __dirname directly
      indexPath = path.join(__dirname, 'app', 'dist', 'index.html');
      console.log('Trying path 4:', indexPath, 'exists:', fs.existsSync(indexPath));
    }
    
    if (fs.existsSync(indexPath)) {
      console.log('Loading production build from:', indexPath);
      win.loadFile(indexPath).catch(err => {
        console.error('Error loading file:', err);
        win.webContents.openDevTools(); // Open devtools to see the error
      });
    } else {
      console.error('ERROR: Could not find index.html in any expected location!');
      console.error('Searched paths:');
      console.error('  1:', path.join(process.resourcesPath, 'app', 'dist', 'index.html'));
      console.error('  2:', path.join(__dirname, '..', 'app', 'dist', 'index.html'));
      console.error('  3:', path.join(app.getAppPath(), 'app', 'dist', 'index.html'));
      console.error('  4:', path.join(__dirname, 'app', 'dist', 'index.html'));
      win.webContents.openDevTools(); // Open devtools to see the error
    }
  }
  
  // Debug: log jika preload script ter-load
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`
      console.log('Electron API available:', typeof window.electron !== 'undefined');
      console.log('addSoundCloud available:', typeof window.electron?.addSoundCloud === 'function');
    `).catch(console.error);
  });
  
  // Log console messages from renderer
  win.webContents.on('console-message', (event, level, message) => {
    console.log(`[Renderer ${level}]:`, message);
  });
  
  // Store window reference for progress updates
  mainWindow = win;
}

app.whenReady().then(createWindow);

// Helper function to get yt-dlp path
function getYtDlpPath() {
  const isWindows = process.platform === 'win32';
  const exeExtension = isWindows ? '.exe' : '';
  const binaryName = 'yt-dlp' + exeExtension;
  
  // Check common macOS installation paths first
  const commonPaths = [
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp'
  ];
  
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  // In production, check for bundled yt-dlp
  if (app.isPackaged) {
    const bundledPath = path.join(process.resourcesPath, 'bin', binaryName);
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
    // Fallback: try other possible locations
    const altPath = path.join(__dirname, '..', 'bin', binaryName);
    if (fs.existsSync(altPath)) {
      return altPath;
    }
  }
  
  // Last resort - try system PATH
  return 'yt-dlp' + exeExtension;
}

// Helper function to get ffmpeg path
function getFfmpegPath() {
  // Check common macOS installation paths first
  const commonPaths = [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg'
  ];
  
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  // In production, check for bundled ffmpeg
  if (app.isPackaged) {
    const bundledPath = path.join(process.resourcesPath, 'bin', 'ffmpeg');
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
    const altPath = path.join(__dirname, '..', 'bin', 'ffmpeg');
    if (fs.existsSync(altPath)) {
      return altPath;
    }
  }
  
  // Last resort - try system PATH
  return 'ffmpeg';
}

// Helper function to get aubio path
function getAubioPath() {
  // Check common macOS installation paths first
  const commonPaths = [
    '/opt/homebrew/bin/aubio',
    '/usr/local/bin/aubio',
    '/usr/bin/aubio'
  ];
  
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  // In production, check for bundled aubio
  if (app.isPackaged) {
    const bundledPath = path.join(process.resourcesPath, 'bin', 'aubio');
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
    const altPath = path.join(__dirname, '..', 'bin', 'aubio');
    if (fs.existsSync(altPath)) {
      return altPath;
    }
  }
  
  // Last resort - try system PATH
  return 'aubio';
}

// Helper function to clean SoundCloud URL from unnecessary query parameters
function cleanSoundCloudUrl(url) {
  if (!url || typeof url !== 'string') {
    console.log('Invalid URL provided, returning as-is');
    return url;
  }
  
  try {
    // Basic validation - check if it looks like a URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      console.log('URL does not start with http:// or https://, returning as-is');
      return url;
    }
    
    const urlObj = new URL(url);
    // Remove unnecessary query parameters that might cause issues with yt-dlp
    const paramsToRemove = ['si', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'fbclid', 'gclid'];
    let hasRemovedParams = false;
    paramsToRemove.forEach(param => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.delete(param);
        hasRemovedParams = true;
      }
    });
    
    // Return clean URL
    const cleanUrl = urlObj.toString();
    if (hasRemovedParams) {
      console.log('Removed query parameters from URL');
    }
    return cleanUrl;
  } catch (error) {
    // If URL parsing fails, return original URL
    console.log('Error parsing URL, using original:', error.message);
    return url;
  }
}

// Handler untuk menambahkan track (SoundCloud atau Spotify)
ipcMain.handle('soundcloud:add', async (_, url) => {
  try {
    // Detect URL source
    const source = detectUrlSource(url);
    console.log('URL source detected:', source);
    
    if (source === 'unknown') {
      throw new Error('Unsupported URL. Please provide a SoundCloud, Spotify, or Bandcamp track URL.');
    }

    // Route to appropriate handler
    if (source === 'spotify') {
      // Process Spotify track
      return await processSpotifyTrack(url);
    }

    // === SOUNDCLOUD / BANDCAMP FLOW (generic yt-dlp) ===
    // Bandcamp is yt-dlp-compatible and reuses this exact path; the SoundCloud
    // and Spotify branches above are untouched.
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
    // Include playlist/album info to get album artwork
    // Note: We don't use --write-thumbnail here to avoid writing to read-only filesystem
    // Instead, we extract thumbnail URL from JSON and download it separately
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
      // Provide more helpful error message
      if (infoError.message && infoError.message.includes('JSON')) {
        throw new Error(`Failed to get track information. The URL might be invalid or the track might be unavailable. Original error: ${infoError.message}`);
      } else if (infoError.message && (infoError.message.includes('yt-dlp') || infoError.message.includes('not found'))) {
        throw new Error(`yt-dlp not found or not working. Please ensure yt-dlp is installed and accessible. Original error: ${infoError.message}`);
      } else {
        throw new Error(`Failed to process SoundCloud URL. Please check if the URL is valid and the track is available. Original error: ${infoError.message || infoError}`);
      }
    }

    // Download track - coba dengan format yang tersedia tanpa conversion dulu
    // Jika perlu conversion, akan error dan kita handle
    const downloadArgs = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--prefer-ffmpeg',
      '-o', path.join(outputDir, `${info.id}.%(ext)s`),
      cleanUrl
    ];

    // Get files before download
    const filesBefore = new Set();
    if (fs.existsSync(outputDir)) {
      const existingFiles = fs.readdirSync(outputDir);
      existingFiles.forEach(f => filesBefore.add(f));
    }
    
    // Delete existing file with same ID to ensure fresh download
    const possibleExtensions = ['mp3', 'm4a', 'mp4', 'aac', 'ogg', 'flac', 'opus', 'webm'];
    for (const ext of possibleExtensions) {
      const existingFile = path.join(outputDir, `${info.id}.${ext}`);
      if (fs.existsSync(existingFile)) {
        console.log(`Deleting existing file: ${existingFile}`);
        fs.unlinkSync(existingFile);
      }
    }
    
    try {
      await execFileAsync(ytDlpPath, downloadArgs);
    } catch (downloadError) {
      // Jika error karena ffmpeg, coba download format asli tanpa conversion
      if (downloadError.message && (downloadError.message.includes('ffmpeg') || downloadError.message.includes('ffprobe'))) {
        console.log('ffmpeg not found, trying to download original format...');
        const originalArgs = [
          '-x',
          '-f', 'bestaudio',
          '-o', path.join(outputDir, `${info.id}.%(ext)s`),
          cleanUrl
        ];
        await execFileAsync(ytDlpPath, originalArgs);
      } else {
        throw downloadError;
      }
    }

    // Tunggu sebentar untuk memastikan file sudah ditulis
    await new Promise(resolve => setTimeout(resolve, 500));

    // Cari file yang baru saja didownload (support berbagai format audio)
    const filesAfter = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : [];
    const audioExtensions = ['.mp3', '.m4a', '.opus', '.ogg', '.webm', '.flac', '.wav', '.aac', '.mka'];
    
    // Cari file baru yang tidak ada di filesBefore
    let downloadedFile = filesAfter.find(f => 
      !filesBefore.has(f) && 
      audioExtensions.some(ext => f.toLowerCase().endsWith(ext))
    );
    
    // Jika tidak ditemukan file baru, coba cari file dengan ID yang sama
    if (!downloadedFile) {
      downloadedFile = filesAfter.find(f => 
        f.startsWith(info.id.toString()) && 
        audioExtensions.some(ext => f.toLowerCase().endsWith(ext))
      );
    }
    
    // Jika masih tidak ditemukan, cari file audio terbaru berdasarkan waktu modifikasi
    if (!downloadedFile) {
      const audioFiles = filesAfter
        .filter(f => audioExtensions.some(ext => f.toLowerCase().endsWith(ext)))
        .map(f => ({
          name: f,
          path: path.join(outputDir, f),
          mtime: fs.statSync(path.join(outputDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.mtime - a.mtime);
      
      if (audioFiles.length > 0) {
        // Ambil file terbaru yang dimodifikasi dalam 30 detik terakhir
        const recentFile = audioFiles.find(f => 
          Date.now() - f.mtime < 30000
        );
        if (recentFile) {
          downloadedFile = recentFile.name;
        }
      }
    }
    
    if (!downloadedFile) {
      console.error('Files before:', Array.from(filesBefore));
      console.error('Files after:', filesAfter);
      console.error('Output dir:', outputDir);
      throw new Error(`Downloaded file not found. Files in directory: ${filesAfter.join(', ')}`);
    }
    
    const filePath = path.join(outputDir, downloadedFile);

    // Gunakan path absolut dengan file:// protocol
    const trackId = Date.now();
    const absolutePath = path.resolve(filePath);
    
    // Extract BPM dan Key dari metadata
    let bpm = null;
    let key = null;
    
    try {
      console.log('Extracting BPM/Key from track:', info.title);
      
      // Cek apakah ada di tags SoundCloud
      if (info.tags) {
        const tags = Array.isArray(info.tags) ? info.tags : [info.tags];
        console.log('Tags found:', tags);
        // Cari BPM dan Key di tags
        tags.forEach(tag => {
          if (typeof tag === 'string') {
            const bpmMatch = tag.match(/bpm[:\s]*(\d+)/i);
            if (bpmMatch) {
              bpm = parseInt(bpmMatch[1]);
              console.log('BPM found in tags:', bpm);
            }
            
            const keyMatch = tag.match(/([A-G][#b]?m?)\s*(?:key|tonality)/i);
            if (keyMatch) {
              key = keyMatch[1];
              console.log('Key found in tags:', key);
            }
          }
        });
      }
      
      // Cek di description
      if (info.description) {
        const desc = info.description;
        console.log('Description length:', desc.length);
        const bpmMatch = desc.match(/bpm[:\s]*(\d+)/i);
        if (bpmMatch && !bpm) {
          bpm = parseInt(bpmMatch[1]);
          console.log('BPM found in description:', bpm);
        }
        
        const keyMatch = desc.match(/([A-G][#b]?m?)\s*(?:key|tonality)/i);
        if (keyMatch && !key) {
          key = keyMatch[1];
          console.log('Key found in description:', key);
        }
      }
      
      // Cek di title (kadang ada BPM di title)
      if (info.title && !bpm) {
        const titleBpmMatch = info.title.match(/bpm[:\s]*(\d+)/i);
        if (titleBpmMatch) {
          bpm = parseInt(titleBpmMatch[1]);
          console.log('BPM found in title:', bpm);
        }
      }
      
      // Jika tidak ada, coba extract dari file audio menggunakan music-metadata
      if ((!bpm || !key) && mm) {
        try {
          console.log('Trying to extract from audio file metadata...');
          const metadata = await mm.parseFile(absolutePath);
          console.log('Audio metadata:', {
            bpm: metadata.common.bpm,
            key: metadata.common.initialKey || metadata.common.key,
            comment: metadata.common.comment
          });
          
          // BPM dari metadata
          if (!bpm && metadata.common.bpm) {
            bpm = Math.round(metadata.common.bpm);
            console.log('BPM found in audio metadata:', bpm);
          }
          
          // Key dari metadata (biasanya di comment atau custom field)
          if (!key) {
            key = metadata.common.initialKey || 
                  metadata.common.key || 
                  (metadata.common.comment && Array.isArray(metadata.common.comment) 
                    ? metadata.common.comment.find(c => c && typeof c === 'string' && /[A-G][#b]?m?/i.test(c))?.match(/([A-G][#b]?m?)/i)?.[1]
                    : null) ||
                  null;
            if (key) {
              console.log('Key found in audio metadata:', key);
            }
          }
        } catch (mmError) {
          // music-metadata error, skip
          console.log('Error extracting metadata from audio file:', mmError.message);
        }
      }
      
      // Jika BPM masih tidak ditemukan, coba detect menggunakan analisis audio
      if (!bpm) {
        try {
          console.log('Attempting to detect BPM from audio analysis...');
          bpm = await detectBPMFromAudio(absolutePath);
          if (bpm) {
            console.log('BPM detected from audio analysis:', bpm);
          }
        } catch (bpmError) {
          console.log('Error detecting BPM from audio:', bpmError.message);
        }
      }
      
      console.log('Final BPM:', bpm, 'Key:', key);
    } catch (metaError) {
      console.log('Error extracting BPM/Key:', metaError.message);
    }
    
    // Download and embed artwork
    let artworkPath = null;
    let thumbnailUrl = null;
    
    // Helper function to extract URL from thumbnail object or string
    const extractThumbnailUrl = (thumb) => {
      if (!thumb) return null;
      if (typeof thumb === 'string') return thumb;
      if (thumb.url) return thumb.url;
      if (thumb.id) {
        // SoundCloud sometimes uses ID-based URLs
        return `https://i1.sndcdn.com/artworks-${thumb.id}-large.jpg`;
      }
      return null;
    };
    
    // Try multiple sources for artwork with comprehensive fallbacks
    // 1. Try track thumbnail (direct)
    if (info.thumbnail) {
      thumbnailUrl = extractThumbnailUrl(info.thumbnail);
    }
    
    // 2. Try thumbnails array (usually has higher quality)
    if (!thumbnailUrl && info.thumbnails) {
      if (Array.isArray(info.thumbnails) && info.thumbnails.length > 0) {
        // Try all thumbnails from highest to lowest quality
        for (let i = info.thumbnails.length - 1; i >= 0; i--) {
          const thumb = info.thumbnails[i];
          const url = extractThumbnailUrl(thumb);
          if (url) {
            thumbnailUrl = url;
            break;
          }
        }
      } else if (typeof info.thumbnails === 'object') {
        // Sometimes thumbnails is an object with quality keys
        thumbnailUrl = extractThumbnailUrl(info.thumbnails.large || info.thumbnails.default || info.thumbnails.medium);
      }
    }
    
    // 3. Try artwork field (SoundCloud specific)
    if (!thumbnailUrl && info.artwork_url) {
      thumbnailUrl = info.artwork_url;
    }
    
    // 4. Try track artwork_url (SoundCloud)
    if (!thumbnailUrl && info.track && info.track.artwork_url) {
      thumbnailUrl = info.track.artwork_url;
    }
    
    // 5. Try album/playlist artwork if available
    if (!thumbnailUrl && info.album) {
      if (info.album.thumbnail) {
        thumbnailUrl = extractThumbnailUrl(info.album.thumbnail);
      } else if (info.album.thumbnails && Array.isArray(info.album.thumbnails) && info.album.thumbnails.length > 0) {
        thumbnailUrl = extractThumbnailUrl(info.album.thumbnails[info.album.thumbnails.length - 1]);
      } else if (info.album.artwork_url) {
        thumbnailUrl = info.album.artwork_url;
      }
    }
    
    // 6. Try playlist artwork if track is in a playlist
    if (!thumbnailUrl && info.playlist) {
      if (info.playlist.thumbnail) {
        thumbnailUrl = extractThumbnailUrl(info.playlist.thumbnail);
      } else if (info.playlist.artwork_url) {
        thumbnailUrl = info.playlist.artwork_url;
      } else if (info.playlist.thumbnails && Array.isArray(info.playlist.thumbnails) && info.playlist.thumbnails.length > 0) {
        thumbnailUrl = extractThumbnailUrl(info.playlist.thumbnails[info.playlist.thumbnails.length - 1]);
      }
    }
    
    // 7. Try uploader/artist artwork as last resort
    if (!thumbnailUrl && info.uploader_thumbnail) {
      thumbnailUrl = extractThumbnailUrl(info.uploader_thumbnail);
    }
    
    // 8. Try to construct SoundCloud artwork URL from track ID if available
    if (!thumbnailUrl && info.id) {
      // SoundCloud artwork URL pattern: https://i1.sndcdn.com/artworks-{id}-large.jpg
      // Try to extract ID from various sources
      let artworkId = null;
      if (info.artwork_url) {
        const match = info.artwork_url.match(/artworks-([^-]+)/);
        if (match) artworkId = match[1];
      }
      if (!artworkId && info.thumbnails) {
        // Try to find ID in thumbnails
        const thumbStr = JSON.stringify(info.thumbnails);
        const match = thumbStr.match(/artworks-([^-]+)/);
        if (match) artworkId = match[1];
      }
      if (artworkId) {
        thumbnailUrl = `https://i1.sndcdn.com/artworks-${artworkId}-large.jpg`;
      }
    }
    
    // Log all available fields for debugging
    console.log('Artwork search - Available fields:', {
      thumbnail: info.thumbnail,
      thumbnails: info.thumbnails,
      artwork_url: info.artwork_url,
      album: info.album,
      playlist: info.playlist,
      uploader_thumbnail: info.uploader_thumbnail,
      track: info.track ? { artwork_url: info.track.artwork_url } : null
    });
    
    if (thumbnailUrl) {
      try {
        // Replace size modifiers in SoundCloud URLs to get larger images
        thumbnailUrl = thumbnailUrl.replace(/-t\d+x\d+\.jpg/, '-large.jpg');
        thumbnailUrl = thumbnailUrl.replace(/-small\.jpg/, '-large.jpg');
        thumbnailUrl = thumbnailUrl.replace(/-medium\.jpg/, '-large.jpg');
        thumbnailUrl = thumbnailUrl.replace(/-t\d+x\d+\.png/, '-large.png');
        
        const artworkDir = path.join(app.getPath('userData'), 'artwork');
        if (!fs.existsSync(artworkDir)) {
          fs.mkdirSync(artworkDir, { recursive: true });
        }
        artworkPath = path.join(artworkDir, `${info.id}.jpg`);
        console.log('Downloading artwork from:', thumbnailUrl);
        await downloadArtwork(thumbnailUrl, artworkPath);
        console.log('Artwork downloaded successfully');
        
        // Artwork will be embedded together with metadata in writeMetadataToFile
        // No need to embed separately to avoid overwriting
        console.log('Artwork ready for embedding');
      } catch (artworkError) {
        console.log('Error downloading/embedding artwork:', artworkError.message);
        console.log('Artwork error stack:', artworkError.stack);
        
        // Fallback: Try to download thumbnail using yt-dlp
        try {
          console.log('Trying to download thumbnail using yt-dlp as fallback...');
          const thumbnailDir = path.join(app.getPath('userData'), 'artwork');
          if (!fs.existsSync(thumbnailDir)) {
            fs.mkdirSync(thumbnailDir, { recursive: true });
          }
          // Use absolute path and ensure it's writable
          const thumbnailOutputPath = path.resolve(thumbnailDir, `${info.id}.%(ext)s`);
          
          const thumbnailArgs = [
            '--write-thumbnail',
            '--skip-download',
            '--convert-thumbnails', 'jpg',
            '--no-warnings',
            '-o', thumbnailOutputPath,
            cleanUrl
          ];
          
          // Change working directory to thumbnailDir to avoid write issues
          const originalCwd = process.cwd();
          try {
            process.chdir(thumbnailDir);
            await execFileAsync(ytDlpPath, thumbnailArgs);
          } finally {
            process.chdir(originalCwd);
          }
          
          // Find the downloaded thumbnail file
          const files = fs.readdirSync(thumbnailDir);
          const thumbnailFile = files.find(f => f.startsWith(`${info.id}.`));
          if (thumbnailFile) {
            artworkPath = path.join(thumbnailDir, thumbnailFile);
            console.log('Thumbnail downloaded using yt-dlp:', artworkPath);
            
            // Artwork will be embedded together with metadata in writeMetadataToFile
            console.log('Artwork ready for embedding using yt-dlp thumbnail');
          }
        } catch (ytDlpThumbnailError) {
          console.log('Error downloading thumbnail with yt-dlp:', ytDlpThumbnailError.message);
          // Continue even if all artwork methods fail
        }
      }
    } else {
      console.log('No artwork thumbnail found in track info, trying yt-dlp thumbnail download...');
      
      // Last resort: Try to download thumbnail using yt-dlp directly
      try {
        const thumbnailDir = path.join(app.getPath('userData'), 'artwork');
        if (!fs.existsSync(thumbnailDir)) {
          fs.mkdirSync(thumbnailDir, { recursive: true });
        }
        // Use absolute path and ensure it's writable
        const thumbnailOutputPath = path.resolve(thumbnailDir, `${info.id}.%(ext)s`);
        
        const thumbnailArgs = [
          '--write-thumbnail',
          '--skip-download',
          '--convert-thumbnails', 'jpg',
          '--no-warnings',
          '-o', thumbnailOutputPath,
          cleanUrl
        ];
        
        // Change working directory to thumbnailDir to avoid write issues
        const originalCwd = process.cwd();
        try {
          process.chdir(thumbnailDir);
          await execFileAsync(ytDlpPath, thumbnailArgs);
        } finally {
          process.chdir(originalCwd);
        }
        
        // Find the downloaded thumbnail file
        const files = fs.readdirSync(thumbnailDir);
        const thumbnailFile = files.find(f => f.startsWith(`${info.id}.`));
        if (thumbnailFile) {
          artworkPath = path.join(thumbnailDir, thumbnailFile);
          console.log('Thumbnail downloaded using yt-dlp:', artworkPath);
          
          // Artwork will be embedded together with metadata in writeMetadataToFile
          console.log('Artwork ready for embedding using yt-dlp thumbnail');
        }
      } catch (ytDlpThumbnailError) {
        console.log('Error downloading thumbnail with yt-dlp:', ytDlpThumbnailError.message);
        console.log('Available info fields:', Object.keys(info));
        // Continue even if all artwork methods fail
      }
    }
    
    // Write BPM dan Key ke metadata file audio agar terbaca di Rekordbox
    try {
      // Log file info before writing
      if (fs.existsSync(absolutePath)) {
        const beforeStats = fs.statSync(absolutePath);
        console.log('File before metadata write - size:', beforeStats.size, 'bytes, path:', absolutePath);
        console.log('File extension:', path.extname(absolutePath).toLowerCase());
      } else {
        console.log('WARNING: File does not exist before metadata write:', absolutePath);
      }
      
      console.log('Writing metadata with artwork path:', artworkPath);
      console.log('Artwork path exists:', artworkPath ? fs.existsSync(artworkPath) : 'N/A');
      
      // For M4A files, check if file already has artwork and log it
      const fileExt = path.extname(absolutePath).toLowerCase();
      if (fileExt === '.m4a' && fs.existsSync(absolutePath)) {
        try {
          let ffprobePath = getFfmpegPath().replace('ffmpeg', 'ffprobe');
          if (!fs.existsSync(ffprobePath)) {
            const commonProbePaths = ['ffprobe', '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'];
            for (const probePath of commonProbePaths) {
              if (fs.existsSync(probePath)) {
                ffprobePath = probePath;
                break;
              }
            }
          }
          if (fs.existsSync(ffprobePath)) {
            const probeArgs = ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', absolutePath];
            const { stdout: probeStdout } = await execFileAsync(ffprobePath, probeArgs);
            if (probeStdout && probeStdout.toString().trim()) {
              console.log('WARNING: M4A file already has artwork stream before embedding:', probeStdout.toString().trim());
              console.log('This may prevent new artwork from being added. File will be processed anyway.');
            } else {
              console.log('M4A file does not have artwork stream - good, will add new artwork');
            }
          }
        } catch (probeError) {
          // Ignore probe errors
        }
      }
      
      await writeMetadataToFile(absolutePath, {
        bpm: bpm,
        key: key,
        title: info.title || 'Unknown',
        artist: info.uploader || info.channel || 'Unknown Artist',
        artworkPath: artworkPath
      });
      
      // Verify file after writing
      if (fs.existsSync(absolutePath)) {
        const afterStats = fs.statSync(absolutePath);
        console.log('File after metadata write - size:', afterStats.size, 'bytes');
      } else {
        console.log('ERROR: File does not exist after metadata write:', absolutePath);
      }
      
      console.log('Metadata written to file successfully');
    } catch (writeError) {
      console.log('Error writing metadata to file:', writeError.message);
      console.log('Error stack:', writeError.stack);
      // Continue even if metadata write fails
    }
    
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
      artworkPath: artworkPath || null, // Store artwork path for later use
      source: source // Detected source: 'soundcloud' or 'bandcamp'
    };
    
    console.log('Returning track data:', trackData);
    return trackData;
  } catch (error) {
    console.error('Error adding track:', error);
    console.error('Error stack:', error.stack);
    // Provide user-friendly error message
    const errorMessage = error.message || 'Unknown error occurred';
    throw new Error(`Failed to add track: ${errorMessage}`);
  }
});

// Helper function to get next available ILOVEMUSIC zip filename
function getNextILoveMusicZipPath(downloadsPath) {
  let counter = 1;
  let zipPath;
  do {
    zipPath = path.join(downloadsPath, `ILOVEMUSIC(${counter}).zip`);
    counter++;
  } while (fs.existsSync(zipPath) && counter < 1000); // Prevent infinite loop
  
  return zipPath;
}

// Helper function to send progress update
function sendDownloadProgress(progress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download:progress', progress);
  }
}

// Handler untuk download track ke folder Downloads
ipcMain.handle('soundcloud:download', async (_, trackIds, tracks) => {
  try {
    const downloadsPath = app.getPath('downloads');
    const outputDir = path.join(app.getPath('userData'), 'tracks');

    if (trackIds.length === 1) {
      // Single track download
      const track = tracks.find(t => t.id === trackIds[0]);
      if (!track || !track.filePath) {
        throw new Error('Track file not found');
      }

      const fileExt = path.extname(track.filePath).toLowerCase() || '.mp3';
      const fileName = `${track.title} - ${track.artist}${fileExt}`.replace(/[<>:"/\\|?*]/g, '_');
      const destPath = path.join(downloadsPath, fileName);
      
      // Get file size for progress calculation
      const stats = fs.statSync(track.filePath);
      const fileSize = stats.size;
      let copiedBytes = 0;
      
      // Copy file with progress tracking
      sendDownloadProgress(0);
      const readStream = fs.createReadStream(track.filePath);
      const writeStream = fs.createWriteStream(destPath);
      
      // Track progress updates
      let lastProgress = 0;
      readStream.on('data', (chunk) => {
        copiedBytes += chunk.length;
        const progress = Math.min(90, Math.round((copiedBytes / fileSize) * 90)); // Reserve 10% for metadata embedding
        // Only send progress if it changed (to avoid too many updates)
        if (progress !== lastProgress) {
          sendDownloadProgress(progress);
          lastProgress = progress;
        }
      });
      
      readStream.pipe(writeStream);
      
      await new Promise((resolve, reject) => {
        writeStream.on('finish', async () => {
          try {
            // Ensure artwork is embedded in the downloaded file
            let artworkPathToUse = track.artworkPath;
            
            // If artworkPath is not in track data, try to find it from artwork directory
            if (!artworkPathToUse || !fs.existsSync(artworkPathToUse)) {
              const artworkDir = path.join(app.getPath('userData'), 'artwork');
              if (fs.existsSync(artworkDir)) {
                const files = fs.readdirSync(artworkDir);
                const artworkFile = files.find(f => f.startsWith(`${track.id}.`));
                if (artworkFile) {
                  artworkPathToUse = path.join(artworkDir, artworkFile);
                }
              }
            }
            
            // Embed artwork and metadata if artwork exists
            if (artworkPathToUse && fs.existsSync(artworkPathToUse)) {
              console.log('Embedding artwork to downloaded file:', destPath);
              console.log('Using artwork path:', artworkPathToUse);
              
              await writeMetadataToFile(destPath, {
                title: track.title || 'Unknown',
                artist: track.artist || 'Unknown Artist',
                bpm: track.bpm || null,
                key: track.key || null,
                artworkPath: artworkPathToUse
              });
              
              console.log('Artwork embedded successfully to downloaded file');
            } else {
              // Even without artwork, ensure metadata is written
              console.log('No artwork found, writing metadata only');
              await writeMetadataToFile(destPath, {
                title: track.title || 'Unknown',
                artist: track.artist || 'Unknown Artist',
                bpm: track.bpm || null,
                key: track.key || null,
                artworkPath: null
              });
            }
            
            // Ensure 100% is sent
            sendDownloadProgress(100);
            // Small delay to ensure progress is sent and UI updates
            setTimeout(() => {
              resolve();
            }, 300);
          } catch (embedError) {
            console.error('Error embedding artwork during download:', embedError);
            // Still resolve - file was copied successfully
            sendDownloadProgress(100);
            setTimeout(() => {
              resolve();
            }, 300);
          }
        });
        writeStream.on('error', reject);
        readStream.on('error', reject);
      });
      
      return { success: true, path: destPath };
    } else {
      // Multiple tracks - create ZIP with ILOVEMUSIC naming
      const archiver = require('archiver');
      const zipPath = getNextILoveMusicZipPath(downloadsPath);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      // First, copy all files to a temp directory with artwork embedded
      const tempDir = path.join(app.getPath('temp'), `ilovemusic-download-${Date.now()}`);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Process all tracks with artwork embedding
      const processTracks = async () => {
        const processedFiles = [];
        
        for (const trackId of trackIds) {
          const track = tracks.find(t => t.id === trackId);
          if (track && track.filePath && fs.existsSync(track.filePath)) {
            const fileExt = path.extname(track.filePath).toLowerCase() || '.mp3';
            const fileName = `${track.title} - ${track.artist}${fileExt}`.replace(/[<>:"/\\|?*]/g, '_');
            const tempFilePath = path.join(tempDir, fileName);
            
            // Copy file first
            fs.copyFileSync(track.filePath, tempFilePath);
            
            // Find artwork path
            let artworkPathToUse = track.artworkPath;
            if (!artworkPathToUse || !fs.existsSync(artworkPathToUse)) {
              const artworkDir = path.join(app.getPath('userData'), 'artwork');
              if (fs.existsSync(artworkDir)) {
                const files = fs.readdirSync(artworkDir);
                const artworkFile = files.find(f => f.startsWith(`${track.id}.`));
                if (artworkFile) {
                  artworkPathToUse = path.join(artworkDir, artworkFile);
                }
              }
            }
            
            // Embed artwork and metadata
            try {
              if (artworkPathToUse && fs.existsSync(artworkPathToUse)) {
                console.log('Embedding artwork to file for ZIP:', tempFilePath);
                await writeMetadataToFile(tempFilePath, {
                  title: track.title || 'Unknown',
                  artist: track.artist || 'Unknown Artist',
                  bpm: track.bpm || null,
                  key: track.key || null,
                  artworkPath: artworkPathToUse
                });
              } else {
                // Even without artwork, ensure metadata is written
                await writeMetadataToFile(tempFilePath, {
                  title: track.title || 'Unknown',
                  artist: track.artist || 'Unknown Artist',
                  bpm: track.bpm || null,
                  key: track.key || null,
                  artworkPath: null
                });
              }
            } catch (embedError) {
              console.error('Error embedding artwork for track:', track.title, embedError);
              // Continue anyway - file was copied
            }
            
            processedFiles.push({ path: tempFilePath, name: fileName });
          }
        }
        
        return processedFiles;
      };
      
      // Process tracks first, then create ZIP
      const processedFiles = await processTracks();

      return new Promise((resolve, reject) => {
        archive.on('error', reject);
        
        // Track progress for ZIP creation
        archive.on('progress', (progress) => {
          // progress.entries.processed = files processed
          // progress.entries.total = total files
          // progress.bytes.processed = bytes processed
          // progress.bytes.total = total bytes (if available)
          let percent = 0;
          if (progress.entries.total > 0) {
            percent = Math.round((progress.entries.processed / progress.entries.total) * 100);
          } else if (progress.bytes.total > 0) {
            percent = Math.round((progress.bytes.processed / progress.bytes.total) * 100);
          }
          sendDownloadProgress(Math.min(100, percent));
        });
        
        output.on('close', () => {
          // Clean up temp directory
          try {
            if (fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
          } catch (cleanupError) {
            console.error('Error cleaning up temp directory:', cleanupError);
          }
          
          sendDownloadProgress(100);
          // Small delay to ensure progress is sent and UI updates
          setTimeout(() => {
            resolve({ success: true, path: zipPath });
          }, 200);
        });

        archive.pipe(output);
        
        // Add processed files to archive
        processedFiles.forEach(file => {
          archive.file(file.path, { name: file.name });
        });

        archive.finalize();
      });
    }
  } catch (error) {
    console.error('Error downloading tracks:', error);
    sendDownloadProgress(0); // Reset progress on error
    throw error;
  }
});

// Handler untuk export ke Rekordbox format
ipcMain.handle('exportRekordbox', async (_, tracks) => {
  try {
    const downloadsPath = app.getPath('downloads');
    const xmlPath = path.join(downloadsPath, `ILOVEMUSIC-Rekordbox-${Date.now()}.xml`);
    
    // Create Rekordbox XML format
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<DJ_PLAYLISTS Version="1.0.0">\n';
    xml += '  <PRODUCT Name="ILoveMusic" Version="1.0"/>\n';
    xml += '  <COLLECTION Entries="' + tracks.length + '">\n';
    
    tracks.forEach((track, index) => {
      const trackId = index + 1;
      const fileName = `${track.title} - ${track.artist}.mp3`.replace(/[<>:"/\\|?*]/g, '_');
      const filePath = track.filePath || '';
      
      xml += '    <TRACK TrackID="' + trackId + '" Name="' + escapeXml(track.title || 'Unknown') + '" Artist="' + escapeXml(track.artist || 'Unknown Artist') + '"';
      
      if (track.bpm) {
        xml += ' AverageBpm="' + Math.round(track.bpm) + '"';
      }
      
      if (track.key) {
        xml += ' Tonality="' + escapeXml(track.key) + '"';
      }
      
      if (track.duration) {
        const totalSeconds = Math.round(track.duration);
        xml += ' TotalTime="' + totalSeconds + '"';
      }
      
      xml += ' Location="file://localhost/' + escapeXml(filePath.replace(/\\/g, '/')) + '"';
      xml += '/>\n';
    });
    
    xml += '  </COLLECTION>\n';
    xml += '  <PLAYLISTS>\n';
    xml += '    <NODE Type="0" Name="ROOT" Count="1">\n';
    xml += '      <NODE Name="ILoveMusic Export" Type="1" Entries="' + tracks.length + '">\n';
    
    tracks.forEach((track, index) => {
      xml += '        <TRACK Key="' + (index + 1) + '"/>\n';
    });
    
    xml += '      </NODE>\n';
    xml += '    </NODE>\n';
    xml += '  </PLAYLISTS>\n';
    xml += '</DJ_PLAYLISTS>\n';
    
    fs.writeFileSync(xmlPath, xml, 'utf8');
    
    return { success: true, path: xmlPath };
  } catch (error) {
    console.error('Error exporting to Rekordbox:', error);
    return { success: false, error: error.message };
  }
});

// Helper function to escape XML
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Resolve the Python interpreter for key detection. Prefer a project-local
// virtualenv (keeps librosa out of the PEP-668 system environment); otherwise
// fall back to the system `python3`.
function resolvePythonCmd() {
  const candidates = [
    path.join(__dirname, '.venv', 'bin', 'python3'),
    path.join(__dirname, 'electron', '.venv', 'bin', 'python3'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return 'python3';
}

// Enrich a downloaded track with format, file size, date added, and musical key.
// Format/size/date are immediate; key detection runs via Python/librosa and
// degrades gracefully to '—' when librosa or python3 is unavailable.
ipcMain.handle('enrich-track-metadata', async (_event, filePath) => {
  const result = {
    format: null,
    fileSize: null,
    dateAdded: new Date().toISOString(),
    key: null,
  };

  // Format & file size — synchronous, no external deps
  try {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).replace('.', '').toUpperCase();
    result.format = ext || '—';
    result.fileSize = (stats.size / (1024 * 1024)).toFixed(1) + ' MB';
  } catch (e) {
    result.format = '—';
    result.fileSize = '—';
  }

  // Key detection via Python/librosa
  await new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'electron', 'detect_key.py');
    execFile(resolvePythonCmd(), [scriptPath, filePath], { timeout: 30000 }, (err, stdout) => {
      if (!err && stdout) {
        try {
          const parsed = JSON.parse(stdout.trim());
          result.key = parsed.key || '—';
        } catch {
          result.key = '—';
        }
      } else {
        result.key = '—';
      }
      resolve();
    });
  });

  return result;
});

// Extract embedded ID3 album artwork as a base64 data URL. music-metadata is
// ESM-only, so it must be loaded via dynamic import() from this CJS module.
ipcMain.handle('extract-artwork', async (_event, filePath) => {
  try {
    const mm = await import('music-metadata');
    const metadata = await mm.parseFile(filePath, { skipCovers: false });
    const pictures = metadata.common.picture;
    const cover = mm.selectCover
      ? mm.selectCover(pictures)
      : (pictures && pictures[0]) || null;

    if (!cover) return { artwork: null };

    const base64 = Buffer.from(cover.data).toString('base64');
    const dataUrl = `data:${cover.format};base64,${base64}`;
    return { artwork: dataUrl };
  } catch (e) {
    console.error('Artwork extraction failed:', e);
    return { artwork: null };
  }
});

// ---------------------------------------------------------------------------
// macOS trackpad haptics. Electron exposes no NSHapticFeedbackManager binding,
// so we drive it through a tiny Swift helper. To avoid stuttering during a
// scrub we compile the helper ONCE (cached on disk) and keep ONE long-lived
// process alive, writing a single line per haptic to its stdin. No per-tick
// compile, no process-spawn storm. Degrades to a silent no-op if Swift tooling
// is unavailable or on non-macOS platforms.
// ---------------------------------------------------------------------------
// Objective-C (compiled with clang) rather than Swift: on some toolchains the
// CLT swiftc/SDK versions mismatch and fail to build AppKit, whereas clang
// against the macOS SDK is reliable. The helper reads one pattern name per
// stdin line and fires the corresponding trackpad haptic.
const HAPTIC_OBJC = `#import <AppKit/AppKit.h>
#import <string.h>
int main(void) {
  @autoreleasepool {
    id<NSHapticFeedbackPerformer> performer = [NSHapticFeedbackManager defaultPerformer];
    char line[64];
    while (fgets(line, sizeof(line), stdin)) {
      NSHapticFeedbackPattern pattern = NSHapticFeedbackPatternGeneric;
      if (strncmp(line, "alignment", 9) == 0) pattern = NSHapticFeedbackPatternAlignment;
      else if (strncmp(line, "levelChange", 11) == 0) pattern = NSHapticFeedbackPatternLevelChange;
      [performer performFeedbackPattern:pattern performanceTime:NSHapticFeedbackPerformanceTimeNow];
    }
  }
  return 0;
}
`;

let hapticProc = null;       // long-lived helper process (stdin-driven)
let hapticBin = null;        // path to the compiled helper binary
let hapticInit = null;       // de-dupes concurrent init
let hapticDisabled = false;  // set when tooling/compile is unavailable

function compileHapticBinary() {
  return new Promise((resolve) => {
    try {
      const dir = app.getPath('userData');
      const src = path.join(dir, 'haptic-helper.m');
      const bin = path.join(dir, 'haptic-helper');
      if (fs.existsSync(bin)) return resolve(bin); // cached across launches
      fs.writeFileSync(src, HAPTIC_OBJC, 'utf8');
      execFile(
        'clang',
        ['-framework', 'AppKit', '-framework', 'Foundation', '-x', 'objective-c', src, '-o', bin],
        { timeout: 60000 },
        (err) => {
          if (err) {
            console.warn('Haptic helper compile failed; haptics disabled:', err.message);
            resolve(null);
          } else {
            resolve(bin);
          }
        }
      );
    } catch (e) {
      resolve(null);
    }
  });
}

function ensureHapticProc() {
  if (hapticDisabled) return Promise.resolve(null);
  if (hapticProc && hapticProc.stdin && hapticProc.stdin.writable) {
    return Promise.resolve(hapticProc);
  }
  if (hapticInit) return hapticInit;
  hapticInit = (async () => {
    if (!hapticBin) hapticBin = await compileHapticBinary();
    if (!hapticBin) {
      hapticDisabled = true;
      hapticInit = null;
      return null;
    }
    try {
      const { spawn } = require('child_process');
      const proc = spawn(hapticBin, [], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.on('error', () => { if (hapticProc === proc) hapticProc = null; });
      proc.on('exit', () => { if (hapticProc === proc) hapticProc = null; });
      hapticProc = proc;
    } catch (e) {
      hapticDisabled = true;
    }
    hapticInit = null;
    return hapticProc;
  })();
  return hapticInit;
}

ipcMain.handle('trigger-haptic', async (_event, type = 'alignment') => {
  if (process.platform !== 'darwin' || hapticDisabled) return;
  const proc = await ensureHapticProc();
  if (!proc || !proc.stdin || !proc.stdin.writable) return;
  const t = type === 'levelChange' || type === 'alignment' ? type : 'generic';
  try {
    proc.stdin.write(t + '\n');
  } catch (e) {
    /* helper died mid-write; next call re-spawns it */
  }
});

app.on('will-quit', () => {
  if (hapticProc) {
    try { hapticProc.stdin.end(); } catch (e) { /* ignore */ }
    try { hapticProc.kill(); } catch (e) { /* ignore */ }
    hapticProc = null;
  }
});

// ---------------------------------------------------------------------------
// BPM / Key detection — Layer 1: Spotify Audio Features (env-var creds only).
// NOTE: Spotify deprecated /audio-features (Nov 2024). Apps created after that
// get 403; this layer then returns null and the renderer falls back to the
// existing aubio (BPM) + librosa (key) values. No secrets are hardcoded — uses
// process.env.SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (loaded via dotenv).
// Uses Electron's built-in global fetch (no node-fetch needed/wanted in CJS).
// ---------------------------------------------------------------------------
let _spToken = null;
let _spTokenExp = 0;

async function getSpotifyToken() {
  if (_spToken && Date.now() < _spTokenExp) return _spToken;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;

  const credentials = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token) return null;
  _spToken = data.access_token;
  _spTokenExp = Date.now() + Math.max(0, (data.expires_in || 3600) - 60) * 1000;
  return _spToken;
}

async function getBpmKeyFromSpotify(artist, title) {
  try {
    const token = await getSpotifyToken();
    if (!token) return null;
    const auth = { Authorization: `Bearer ${token}` };

    const query = encodeURIComponent(`track:${title} artist:${artist}`);
    const searchRes = await fetch(
      `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
      { headers: auth }
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const track = searchData?.tracks?.items?.[0];
    if (!track) return null;

    // Genre from the artist endpoint (NOT deprecated — still 200 OK).
    let genre = null;
    const artistId = track.artists?.[0]?.id;
    if (artistId) {
      const artistRes = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers: auth });
      if (artistRes.ok) {
        const artistData = await artistRes.json();
        const rawGenre = artistData?.genres?.[0];
        if (rawGenre) genre = rawGenre.charAt(0).toUpperCase() + rawGenre.slice(1);
      }
    }

    // Tempo/key from audio-features (deprecated → 403 → stays null; genre is
    // still returned so mainstream tracks at least get a genre).
    let bpm = null;
    let key = null;
    const featRes = await fetch(`https://api.spotify.com/v1/audio-features/${track.id}`, { headers: auth });
    if (featRes.ok) {
      const feat = await featRes.json();
      if (feat?.tempo) {
        const keyNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        bpm = Math.round(feat.tempo);
        key = feat.key >= 0 ? `${keyNames[feat.key]} ${feat.mode === 1 ? 'maj' : 'min'}` : null;
      }
    } else if (featRes.status === 403) {
      console.warn('[BPM] Spotify audio-features 403 (deprecated for this app) — returning genre only.');
    }

    return { bpm, key, genre, source: 'spotify' };
  } catch (e) {
    return null;
  }
}

// Orchestrator: try Spotify; on miss/unavailable return null so the renderer
// keeps the existing aubio BPM (set at add time) + librosa key (from enrich).
ipcMain.handle('detect-bpm-key', async (_event, { artist, title } = {}) => {
  if (artist && title) {
    const spotify = await getBpmKeyFromSpotify(artist, title);
    if (spotify && (spotify.bpm || spotify.key || spotify.genre)) {
      console.log(`[BPM] Spotify: ${spotify.bpm ? spotify.bpm + ' BPM' : 'no BPM'}, genre ${spotify.genre || 'none'}`);
      return spotify;
    }
  }
  console.log('[BPM] Spotify miss/unavailable → keeping existing aubio/librosa values');
  return null;
});

// Handler untuk menyimpan tracks ke file
ipcMain.handle('tracks:save', async (_, tracks) => {
  try {
    const userDataPath = app.getPath('userData');
    const tracksFilePath = path.join(userDataPath, 'tracks.json');
    
    // Ensure userData directory exists
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    
    // Save tracks to file
    fs.writeFileSync(tracksFilePath, JSON.stringify(tracks, null, 2), 'utf8');
    console.log('Tracks saved to:', tracksFilePath);
    
    return { success: true };
  } catch (error) {
    console.error('Error saving tracks:', error);
    return { success: false, error: error.message };
  }
});

// Handler untuk memuat tracks dari file
ipcMain.handle('tracks:load', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const tracksFilePath = path.join(userDataPath, 'tracks.json');
    
    // Check if file exists
    if (!fs.existsSync(tracksFilePath)) {
      console.log('Tracks file not found, returning empty array');
      return { success: true, tracks: [] };
    }
    
    // Read and parse tracks from file
    const fileContent = fs.readFileSync(tracksFilePath, 'utf8');
    const tracks = JSON.parse(fileContent);
    console.log('Tracks loaded from:', tracksFilePath, 'Count:', tracks.length);
    
    return { success: true, tracks: tracks };
  } catch (error) {
    console.error('Error loading tracks:', error);
    // Return empty array on error instead of failing
    return { success: true, tracks: [] };
  }
});

// ===========================================================================
// ALBUM / PLAYLIST SUPPORT (Phase 1: SoundCloud sets + Bandcamp albums)
// ===========================================================================

// Scan a downloaded album folder and build full track objects (same shape as
// single-track downloads). Title/artist/duration/artwork come from embedded
// ID3 via music-metadata (ESM → dynamic import). BPM/key are left null for now.
async function buildAlbumTracksFromFolder(dir, source, sourceUrls = []) {
  const mm = await import('music-metadata');
  const exts = ['.mp3', '.m4a', '.flac', '.wav', '.opus', '.ogg'];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => exts.includes(path.extname(f).toLowerCase()));
  } catch {
    return [];
  }
  // Filenames are zero-padded by index, so alphabetical sort == playlist order,
  // which lets sourceUrls[i] line up with each downloaded track.
  files.sort();
  const tracks = [];
  const base = Date.now();
  for (let i = 0; i < files.length; i++) {
    const filePath = path.resolve(path.join(dir, files[i]));
    let title = path.basename(files[i], path.extname(files[i]));
    let artist = 'Unknown Artist';
    let duration = 0;
    let artwork = null;
    try {
      const md = await mm.parseFile(filePath, { skipCovers: false });
      if (md.common.title) title = md.common.title;
      if (md.common.artist) artist = md.common.artist;
      if (md.format.duration) duration = md.format.duration;
      const cover = mm.selectCover ? mm.selectCover(md.common.picture) : (md.common.picture && md.common.picture[0]);
      if (cover) artwork = `data:${cover.format};base64,${Buffer.from(cover.data).toString('base64')}`;
    } catch (e) {
      /* keep filename-derived defaults */
    }
    tracks.push({
      id: base * 1000 + i, // numeric, collision-safe, compatible with handlePlay
      title,
      artist,
      duration,
      currentTime: 0,
      url: `file://${filePath}`,
      filePath,
      bpm: null,
      key: null,
      artwork,
      source,
      sourceUrl: sourceUrls[i] || null, // original URL, for re-download via the crate
    });
  }
  return tracks;
}

// SoundCloud sets / Bandcamp albums — yt-dlp handles these natively as playlists.
ipcMain.handle('download-sc-bandcamp-album', async (event, { url, source } = {}) => {
  try {
    if (!url) throw new Error('No album URL provided');
    const ytDlpPath = getYtDlpPath();
    const albumId = crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
    const outputDir = path.join(app.getPath('userData'), 'tracks', 'albums', albumId);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Playlist metadata first (fast, flat) so the card can appear immediately.
    let info = {};
    try {
      const { stdout } = await execFileAsync(ytDlpPath, ['--dump-single-json', '--flat-playlist', url]);
      info = JSON.parse(stdout);
    } catch (e) {
      console.warn('Album metadata fetch failed:', e.message);
    }
    const entries = Array.isArray(info.entries) ? info.entries : [];
    const entryUrls = entries.map(e => e.url || e.webpage_url || null); // per-track URLs (for crate re-download)
    const albumMeta = {
      id: albumId,
      title: info.title || 'Unknown Album',
      artist: info.uploader || info.channel || 'Unknown Artist',
      artwork: info.thumbnail || null,
      source,
      dateAdded: new Date().toISOString(),
      trackCount: entries.length || null,
      tracks: [],
    };
    event.sender.send('album-meta-ready', albumMeta);

    // Download the whole playlist (zero-padded index keeps file order == playlist order).
    await new Promise((resolve, reject) => {
      const args = [
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--embed-thumbnail',
        '--embed-metadata',
        '-o', path.join(outputDir, '%(playlist_index)02d - %(title)s.%(ext)s'),
        '--newline',
        url,
      ];
      const proc = spawn(ytDlpPath, args);
      proc.stdout.on('data', (d) => {
        event.sender.send('album-download-progress', { albumId, log: d.toString() });
      });
      proc.stderr.on('data', () => {});
      proc.on('close', () => resolve());
      proc.on('error', reject);
    });

    // Build real track objects from the downloaded files.
    const tracks = await buildAlbumTracksFromFolder(outputDir, source, entryUrls);
    const artwork = albumMeta.artwork || (tracks.find(t => t.artwork) || {}).artwork || null;
    event.sender.send('album-tracks-ready', { albumId, tracks, artwork });

    return { success: true, albumId, count: tracks.length };
  } catch (e) {
    console.error('Album download failed:', e);
    return { success: false, error: e.message };
  }
});

// Spotify albums — Spotify hosts no downloadable audio, so we fetch the album
// track list from the API, then download each track via a yt-dlp YouTube search
// (same mechanism as the single Spotify-track flow). Per-track progress is exact
// because we download sequentially.
ipcMain.handle('download-spotify-album', async (event, albumUrl) => {
  try {
    if (!albumUrl) throw new Error('No album URL provided');
    const token = await getSpotifyToken();
    if (!token) throw new Error('Spotify credentials not configured (.env)');
    const auth = { Authorization: `Bearer ${token}` };

    const albumId = (albumUrl.split('/album/')[1] || '').split('?')[0];
    if (!albumId) throw new Error('Invalid Spotify album URL');

    const ytDlpPath = getYtDlpPath();
    const outputDir = path.join(app.getPath('userData'), 'tracks', 'albums', albumId);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Album metadata.
    const albumRes = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, { headers: auth });
    if (!albumRes.ok) throw new Error(`Failed to fetch album (${albumRes.status})`);
    const albumData = await albumRes.json();
    const albumArtist = albumData.artists?.[0]?.name || 'Unknown Artist';
    const albumMeta = {
      id: albumId,
      title: albumData.name || 'Unknown Album',
      artist: albumArtist,
      artwork: albumData.images?.[0]?.url || null,
      source: 'spotify',
      dateAdded: new Date().toISOString(),
      trackCount: albumData.total_tracks || null,
      tracks: [],
    };
    event.sender.send('album-meta-ready', albumMeta);

    // All track stubs (handle pagination).
    let tracksUrl = `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`;
    const allTracks = [];
    while (tracksUrl) {
      const r = await fetch(tracksUrl, { headers: auth });
      if (!r.ok) break;
      const d = await r.json();
      if (Array.isArray(d.items)) allTracks.push(...d.items);
      tracksUrl = d.next;
    }
    const total = allTracks.length;

    // Download each track via YouTube search, sequentially, with exact progress.
    for (let i = 0; i < total; i++) {
      const t = allTracks[i];
      const trackArtist = t.artists?.[0]?.name || albumArtist;
      const searchQuery = `${trackArtist} ${t.name}`;
      event.sender.send('album-download-progress', {
        albumId,
        current: i + 1,
        total,
        trackTitle: t.name,
        done: false,
      });
      try {
        const args = [
          `ytsearch1:${searchQuery}`,
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', '0',
          '--embed-thumbnail',
          '--embed-metadata',
          '-o', path.join(outputDir, `${String(i + 1).padStart(2, '0')} - %(title)s.%(ext)s`),
        ];
        await execFileAsync(ytDlpPath, args, { timeout: 180000 });
      } catch (err) {
        console.warn(`Spotify album track failed (${t.name}):`, err.message);
      }
    }

    // Build real track objects from the downloaded files. Spotify track URLs
    // (in download order) become each track's sourceUrl for crate re-download.
    const spotifyUrls = allTracks.map(t => (t.id ? `https://open.spotify.com/track/${t.id}` : null));
    const tracks = await buildAlbumTracksFromFolder(outputDir, 'spotify', spotifyUrls);
    const artwork = albumMeta.artwork || (tracks.find(t => t.artwork) || {}).artwork || null;
    event.sender.send('album-tracks-ready', { albumId, tracks, artwork });

    return { success: true, albumId, count: tracks.length };
  } catch (e) {
    console.error('Spotify album download failed:', e);
    return { success: false, error: e.message };
  }
});

// Persist albums (mirror of tracks:save / tracks:load).
ipcMain.handle('albums:save', async (_, albums) => {
  try {
    const userDataPath = app.getPath('userData');
    const albumsFilePath = path.join(userDataPath, 'albums.json');
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(albumsFilePath, JSON.stringify(albums, null, 2), 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error saving albums:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('albums:load', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const albumsFilePath = path.join(userDataPath, 'albums.json');
    if (!fs.existsSync(albumsFilePath)) return { success: true, albums: [] };
    const albums = JSON.parse(fs.readFileSync(albumsFilePath, 'utf8'));
    return { success: true, albums };
  } catch (error) {
    console.error('Error loading albums:', error);
    return { success: true, albums: [] };
  }
});

// Reveal a downloaded track file in Finder / file explorer.
ipcMain.handle('show-in-finder', (_, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

// Persist the crate (download wishlist) — mirror of albums:save / albums:load.
ipcMain.handle('crate:save', async (_, crate) => {
  try {
    const userDataPath = app.getPath('userData');
    const crateFilePath = path.join(userDataPath, 'crate.json');
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(crateFilePath, JSON.stringify(crate, null, 2), 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error saving crate:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('crate:load', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const crateFilePath = path.join(userDataPath, 'crate.json');
    if (!fs.existsSync(crateFilePath)) return { success: true, crate: [] };
    const crate = JSON.parse(fs.readFileSync(crateFilePath, 'utf8'));
    return { success: true, crate };
  } catch (error) {
    console.error('Error loading crate:', error);
    return { success: true, crate: [] };
  }
});
