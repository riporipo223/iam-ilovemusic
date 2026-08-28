import React, { useState, useRef, useEffect } from 'react';

/* ----------------------------------------------------------------------------
 * Spatial design tokens (mirrors index.css :root vars; referenced via var())
 * -------------------------------------------------------------------------- */
const ACCENT = 'var(--accent)';
const ACCENT_SOFT = 'var(--accent-soft)';
const DIM = 'var(--dim)';
const FAINT = 'var(--faint)';
const LINE = 'var(--line)';
const PANEL = 'var(--panel)';
const INK = 'var(--ink)';
const MONO = 'var(--mono)';

/* Deterministic per-card cover colours (real tracks carry no artwork data). */
const PALETTE = [
  { frame: '#1f6f78', ink: '#ffffff' },
  { frame: '#c2531f', ink: '#ffffff' },
  { frame: '#e9e6dd', ink: '#15140f' },
  { frame: '#1c2b6b', ink: '#ffffff' },
  { frame: '#211d1a', ink: '#e8b07a' },
  { frame: '#8fbf1e', ink: '#181c08' },
  { frame: '#a3247a', ink: '#ffffff' },
  { frame: '#46525e', ink: '#ffffff' },
  { frame: '#fff6e3', ink: '#1a1407' },
  { frame: '#2f3a86', ink: '#ffffff' },
];
const colorFor = (id, i) => {
  const seed = typeof id === 'number' ? id : i;
  return PALETTE[Math.abs(seed) % PALETTE.length];
};

/* Deterministic decorative waveform bars (visual only). */
const makeBars = (seed, n) => {
  const out = [];
  for (let j = 0; j < n; j++) {
    const a = Math.abs(Math.sin(seed * 12.9898 + j * 4.1337) * 43758.5453) % 1;
    const b = Math.abs(Math.sin(seed * 3.233 + j * 1.7) * 1934.21) % 1;
    out.push(Math.round(18 + (a * 0.65 + b * 0.35) * 82));
  }
  return out;
};

const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

// Identify the download source from a pasted URL (used to auto-switch the modal
// source toggle). The main process re-detects authoritatively before adding.
const detectSource = (url) => {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('soundcloud.com')) return 'soundcloud';
  if (u.includes('spotify.com')) return 'spotify';
  if (u.includes('bandcamp.com')) return 'bandcamp';
  return null;
};

// Classify a URL as a single track vs. an album/playlist. SoundCloud sets are
// detected via `/sets/` (NOT path-segment count, which misfires on normal
// track URLs). Returns { source, type } or null.
const detectUrlType = (url) => {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('spotify.com/album/')) return { source: 'spotify', type: 'album' };
  if (u.includes('spotify.com/track/')) return { source: 'spotify', type: 'track' };
  if (u.includes('soundcloud.com/') && u.includes('/sets/')) return { source: 'soundcloud', type: 'playlist' };
  if (u.includes('soundcloud.com/')) return { source: 'soundcloud', type: 'track' };
  if (u.includes('bandcamp.com/album/')) return { source: 'bandcamp', type: 'album' };
  if (u.includes('bandcamp.com/track/')) return { source: 'bandcamp', type: 'track' };
  return null;
};

// Source values are stored lowercase ('soundcloud' | 'spotify' | 'bandcamp').
// Normalize to display label / short badge, tolerating legacy/capitalized values.
const SOURCE_LABEL = { soundcloud: 'SoundCloud', spotify: 'Spotify', bandcamp: 'Bandcamp' };
const SOURCE_BADGE = { soundcloud: 'SC', spotify: 'SP', bandcamp: 'BC' };
const sourceLabel = (s) => (s ? SOURCE_LABEL[String(s).toLowerCase()] || s : '—');
const sourceBadge = (s) =>
  s ? SOURCE_BADGE[String(s).toLowerCase()] || String(s).slice(0, 2).toUpperCase() : null;

/* ----------------------------------------------------------------------------
 * Inline SVG icon set (ported from the redesign)
 * -------------------------------------------------------------------------- */
const stroke = (children, sw = 1.45) => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 17 17"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);
const ICONS = {
  library: stroke(
    <>
      <rect x="2" y="3" width="13" height="3.2" rx="1.5" />
      <rect x="2" y="7.5" width="13" height="3.2" rx="1.5" />
      <rect x="2" y="12" width="13" height="3.2" rx="1.5" />
    </>
  ),
  downloads: stroke(
    <>
      <line x1="8.5" y1="2" x2="8.5" y2="11" />
      <path d="M5 8 L8.5 11.5 L12 8" />
      <line x1="3" y1="14.5" x2="14" y2="14.5" />
    </>
  ),
  playlists: stroke(
    <>
      <line x1="3" y1="4.5" x2="14" y2="4.5" />
      <line x1="3" y1="8.5" x2="14" y2="8.5" />
      <line x1="3" y1="12.5" x2="10" y2="12.5" />
      <circle cx="13" cy="12.5" r="1.7" />
    </>
  ),
  collections: stroke(
    <>
      <rect x="2.5" y="2.5" width="5" height="5" rx="1.5" />
      <rect x="9.5" y="2.5" width="5" height="5" rx="1.5" />
      <rect x="2.5" y="9.5" width="5" height="5" rx="1.5" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.5" />
    </>
  ),
  bpm: stroke(
    <>
      <line x1="3" y1="10" x2="3" y2="12" />
      <line x1="6" y1="6" x2="6" y2="12" />
      <line x1="9" y1="3" x2="9" y2="12" />
      <line x1="12" y1="7" x2="12" y2="12" />
    </>,
    1.7
  ),
  meta: stroke(
    <>
      <rect x="2.5" y="3" width="12" height="11" rx="1.5" />
      <line x1="5" y1="7" x2="11.5" y2="7" />
      <line x1="5" y1="10.5" x2="9" y2="10.5" />
    </>
  ),
  settings: stroke(
    <>
      <line x1="3" y1="5.5" x2="14" y2="5.5" />
      <circle cx="6" cy="5.5" r="1.9" fill="#0a0a0c" />
      <line x1="3" y1="11.5" x2="14" y2="11.5" />
      <circle cx="11" cy="11.5" r="1.9" fill="#0a0a0c" />
    </>
  ),
  play: (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
      <path d="M4 2.5 L12 7.5 L4 12.5 Z" />
    </svg>
  ),
  pause: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
      <rect x="2.5" y="2" width="3" height="9" rx="1" />
      <rect x="7.5" y="2" width="3" height="9" rx="1" />
    </svg>
  ),
  prev: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="4" width="1.8" height="8" rx="0.9" />
      <path d="M13 4 L6 8 L13 12 Z" />
    </svg>
  ),
  next: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 4 L10 8 L3 12 Z" />
      <rect x="11.2" y="4" width="1.8" height="8" rx="0.9" />
    </svg>
  ),
};

/* Diagonal-stripe album-art placeholder (no artwork in the data model yet). */
const ArtPlaceholder = ({ radius = 0, label }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      borderRadius: radius,
      background:
        'repeating-linear-gradient(135deg, rgba(0,0,0,0.16) 0 13px, rgba(0,0,0,0.05) 13px 26px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: MONO,
      fontSize: '9px',
      letterSpacing: '1px',
      color: FAINT,
      textTransform: 'uppercase',
    }}
  >
    {label}
  </div>
);

/* Compact square album-art slot. Renders artwork when present, otherwise an
   always-visible placeholder (♪). Implemented inline — no image-slot.js. */
const AlbumArt = ({ track, size = 52, radius = 9 }) => {
  const src = track && (track.artwork || track.albumArt);
  const base = {
    width: size,
    height: size,
    flex: 'none',
    borderRadius: radius,
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
  };
  if (src) {
    return <img src={src} alt="" style={{ ...base, objectFit: 'cover' }} />;
  }
  return (
    <div
      style={{
        ...base,
        background: '#1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.45)',
        fontSize: `${Math.round(size * 0.44)}px`,
        lineHeight: 1,
      }}
    >
      ♪
    </div>
  );
};

const ILoveMusic = () => {
  /* ===== Existing core state (preserved) ===== */
  const [selected, setSelected] = useState(new Set());
  const [pastedUrl, setPastedUrl] = useState('');
  const [playingTrack, setPlayingTrack] = useState(null);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [tracks, setTracks] = useState([]);
  const [tracksLoaded, setTracksLoaded] = useState(false);

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBpmMin, setFilterBpmMin] = useState('');
  const [filterBpmMax, setFilterBpmMax] = useState('');
  const [filterArtist, setFilterArtist] = useState('');

  // Sorting state
  const [sortBy, setSortBy] = useState('title'); // 'title', 'artist', 'bpm', 'duration'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc', 'desc'

  const audioRefs = useRef({});
  const downloadProgressRef = useRef(0);

  /* ===== Albums / playlists (Phase 1) ===== */
  const [albums, setAlbums] = useState([]); // album cards; album.tracks live inside, never in `tracks`
  const [albumsLoaded, setAlbumsLoaded] = useState(false);
  const [openAlbum, setOpenAlbum] = useState(null); // album whose inner shelf is open
  const [albumProgress, setAlbumProgress] = useState({}); // { [albumId]: { ...progress, done } }
  const [albumTimes, setAlbumTimes] = useState({}); // { [trackId]: { currentTime, duration } } for inner shelf

  /* ===== Queue (download wishlist) ===== */
  const [queue, setQueue] = useState([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  /* ===== New UI-only state (spatial shell) ===== */
  const [view, setView] = useState('library'); // library | playlists | collections | bpm | settings
  const [selectedIndex, setSelectedIndex] = useState(0); // focused card (inspector / now-playing)
  const [editing, setEditing] = useState(false); // inspector edit mode
  const [downloadOpen, setDownloadOpen] = useState(false); // download modal
  const [dlSource, setDlSource] = useState('soundcloud'); // soundcloud | spotify | bandcamp

  /* Refs driving the 3D shelf rAF loop without triggering React re-renders. */
  const stageRef = useRef(null);
  const sceneRef = useRef(null);
  const curRef = useRef(0);
  const targetRef = useRef(0);
  const lastCRef = useRef(0);
  const lastTimeRef = useRef(0);
  const rafRef = useRef(0);
  const filteredLenRef = useRef(0);
  const actionsRef = useRef({ togglePlayFocused: () => {} });

  // Load tracks from file on mount
  useEffect(() => {
    const loadTracks = async () => {
      try {
        if (window.electron && window.electron.loadTracks) {
          const result = await window.electron.loadTracks();
          if (result.success && result.tracks) {
            setTracks(result.tracks);
            setTracksLoaded(true);
            console.log('Tracks loaded from file:', result.tracks.length);
          } else {
            setTracksLoaded(true);
          }
        } else {
          // Fallback to localStorage for development
          const savedTracks = localStorage.getItem('ilovemusic_tracks');
          if (savedTracks) {
            try {
              const parsedTracks = JSON.parse(savedTracks);
              setTracks(parsedTracks);
            } catch (err) {
              console.error('Error loading tracks from localStorage:', err);
            }
          }
          setTracksLoaded(true);
        }
      } catch (err) {
        console.error('Error loading tracks:', err);
        setTracksLoaded(true);
      }
    };

    loadTracks();
  }, []);

  // Save tracks to file whenever tracks change (but only after initial load)
  useEffect(() => {
    if (!tracksLoaded) return; // Don't save until tracks have been loaded

    const saveTracks = async () => {
      try {
        if (window.electron && window.electron.saveTracks) {
          await window.electron.saveTracks(tracks);
          console.log('Tracks saved to file:', tracks.length);
        } else {
          // Fallback to localStorage for development
          if (tracks.length > 0) {
            localStorage.setItem('ilovemusic_tracks', JSON.stringify(tracks));
          } else {
            localStorage.removeItem('ilovemusic_tracks');
          }
        }
      } catch (err) {
        console.error('Error saving tracks:', err);
      }
    };

    saveTracks();
  }, [tracks, tracksLoaded]);

  // Load albums on mount.
  useEffect(() => {
    const load = async () => {
      try {
        if (window.electron && window.electron.loadAlbums) {
          const result = await window.electron.loadAlbums();
          if (result.success && result.albums) setAlbums(result.albums);
        }
      } catch (err) {
        console.error('Error loading albums:', err);
      } finally {
        setAlbumsLoaded(true);
      }
    };
    load();
  }, []);

  // Persist albums on change. Drop album-level base64 artwork to keep the file
  // small (URL artwork is kept; track-level art inside album.tracks is retained).
  useEffect(() => {
    if (!albumsLoaded) return;
    if (!window.electron || !window.electron.saveAlbums) return;
    const toSave = albums.map(a => ({
      ...a,
      artwork: a.artwork && String(a.artwork).startsWith('data:') ? null : a.artwork,
    }));
    window.electron.saveAlbums(toSave);
  }, [albums, albumsLoaded]);

  // Load queue on mount.
  useEffect(() => {
    const load = async () => {
      try {
        if (window.electron && window.electron.loadQueue) {
          const result = await window.electron.loadQueue();
          if (result.success && result.queue) setQueue(result.queue);
        }
      } catch (err) {
        console.error('Error loading queue:', err);
      } finally {
        setQueueLoaded(true);
      }
    };
    load();
  }, []);

  // Persist queue on change.
  useEffect(() => {
    if (!queueLoaded) return;
    if (window.electron && window.electron.saveQueue) window.electron.saveQueue(queue);
  }, [queue, queueLoaded]);

  // Album download IPC listeners (registered once for the app lifetime).
  useEffect(() => {
    if (!window.electron) return;
    if (window.electron.onAlbumMetaReady) {
      window.electron.onAlbumMetaReady((meta) => {
        setAlbums(prev => (prev.some(a => a.id === meta.id) ? prev : [...prev, meta]));
      });
    }
    if (window.electron.onAlbumDownloadProgress) {
      window.electron.onAlbumDownloadProgress((p) => {
        setAlbumProgress(prev => ({ ...prev, [p.albumId]: { ...prev[p.albumId], ...p } }));
      });
    }
    if (window.electron.onAlbumTracksReady) {
      window.electron.onAlbumTracksReady(({ albumId, tracks: albumTracks, artwork }) => {
        setAlbums(prev =>
          prev.map(a =>
            a.id === albumId
              ? { ...a, tracks: albumTracks, trackCount: albumTracks.length, artwork: a.artwork || artwork }
              : a
          )
        );
        setAlbumProgress(prev => ({ ...prev, [albumId]: { ...prev[albumId], done: true } }));
      });
    }
  }, []);

  // Enrich a freshly-added track with format / file size / date added / key /
  // artwork, plus a Spotify BPM+key lookup (Layer 1). All resolve, then a single
  // merge avoids races: Spotify upgrades BPM/key when available; otherwise the
  // existing aubio BPM (set at add) + librosa key (from enrichment) are kept.
  const enrichTrack = async (track) => {
    if (!window.electron) return;
    const filePath = track.filePath || track.path;
    if (!filePath) return;
    try {
      const [enriched, artworkResult, bpmKey] = await Promise.all([
        window.electron.enrichTrackMetadata
          ? window.electron.enrichTrackMetadata(filePath)
          : Promise.resolve({}),
        window.electron.extractArtwork
          ? window.electron.extractArtwork(filePath)
          : Promise.resolve({ artwork: null }),
        window.electron.detectBpmKey
          ? window.electron.detectBpmKey({ filePath, artist: track.artist, title: track.title })
          : Promise.resolve(null),
      ]);
      const spotifyBpm = bpmKey && bpmKey.bpm != null ? bpmKey.bpm : null;
      const spotifyKey = bpmKey && bpmKey.key ? bpmKey.key : null;
      const spotifyGenre = bpmKey && bpmKey.genre ? bpmKey.genre : null;
      setTracks(prev =>
        prev.map(t =>
          t.id === track.id
            ? {
                ...t,
                format: enriched.format,
                fileSize: enriched.fileSize,
                dateAdded: enriched.dateAdded,
                artwork: artworkResult.artwork,
                // Spotify wins; else keep existing aubio BPM / librosa key.
                bpm: spotifyBpm != null ? spotifyBpm : t.bpm,
                key: spotifyKey != null ? spotifyKey : (enriched.key != null ? enriched.key : t.key),
                // Genre only from Spotify, and only if the track has none yet.
                genre: t.genre != null ? t.genre : spotifyGenre,
                bpmSource: bpmKey && bpmKey.source ? bpmKey.source : 'aubio',
              }
            : t
        )
      );
    } catch (err) {
      console.error('Metadata enrichment failed:', err);
    }
  };

  // Album/playlist downloads run in the background: the card appears via the
  // album-meta-ready listener and fills in when album-tracks-ready arrives.
  const handleAlbumDownload = (urlType) => {
    const url = pastedUrl;
    const onResult = (result) => {
      if (!result || !result.success) {
        alert('Album download failed: ' + ((result && result.error) || 'unknown error'));
      }
    };
    const onErr = (err) => alert('Album download failed: ' + (err.message || 'unknown error'));

    if (urlType.source === 'spotify') {
      if (!window.electron || !window.electron.downloadSpotifyAlbum) {
        alert('Spotify album download is not available in this build.');
        return;
      }
      window.electron.downloadSpotifyAlbum(url).then(onResult).catch(onErr);
    } else {
      if (!window.electron || !window.electron.downloadScBandcampAlbum) {
        alert('Album download is not available in this build.');
        return;
      }
      window.electron.downloadScBandcampAlbum({ url, source: urlType.source }).then(onResult).catch(onErr);
    }
    setPastedUrl('');
    setDownloadOpen(false);
  };

  /* ===== Queue helpers ===== */
  const queueKeyFor = (track, sourceUrl) =>
    sourceUrl || track.sourceUrl || track.filePath || track.id || `${track.title}::${track.artist}`;

  const isInQueue = (track, sourceUrl) => {
    const key = queueKeyFor(track, sourceUrl);
    return queue.some(c => c.id === key || (c.title === track.title && c.artist === track.artist));
  };

  const addToQueue = (track, sourceUrl, fromAlbum = null) => {
    const id = queueKeyFor(track, sourceUrl);
    console.log('[QUEUE] add:', track && track.title, '→ id:', id); // TEMP diagnostic
    setQueue(prev => {
      if (prev.some(c => c.id === id || (c.title === track.title && c.artist === track.artist))) {
        console.log('[QUEUE] already present, skip'); // TEMP diagnostic
        return prev;
      }
      const next = [
        ...prev,
        {
          id,
          title: track.title,
          artist: track.artist,
          artwork: track.artwork ?? null,
          bpm: track.bpm ?? null,
          key: track.key ?? null,
          duration: track.duration ?? null,
          source: track.source,
          sourceUrl: sourceUrl || track.sourceUrl || null,
          fromAlbum,
          addedAt: new Date().toISOString(),
          status: 'queued',
        },
      ];
      console.log('[QUEUE] new length:', next.length); // TEMP diagnostic
      return next;
    });
  };

  const removeFromQueue = (id) => setQueue(prev => prev.filter(i => i.id !== id));
  const setQueueItemStatus = (id, status) => setQueue(prev => prev.map(i => (i.id === id ? { ...i, status } : i)));

  // Queue downloads reuse the real single-track IPC (addSoundCloud routes
  // SoundCloud/Bandcamp/Spotify by URL), then add + enrich into the library.
  const handleQueueDownloadOne = async (item) => {
    if (!item.sourceUrl) {
      setQueueItemStatus(item.id, 'error');
      return;
    }
    if (!window.electron || !window.electron.addSoundCloud) return;
    setQueueItemStatus(item.id, 'downloading');
    try {
      const track = await window.electron.addSoundCloud(item.sourceUrl);
      setTracks(prev => [...prev, track]);
      enrichTrack(track);
      setQueueItemStatus(item.id, 'done');
    } catch (err) {
      console.error('Queue download failed:', err);
      setQueueItemStatus(item.id, 'error');
    }
  };

  const handleQueueDownloadAll = async () => {
    const queued = queue.filter(i => i.status === 'queued' && i.sourceUrl);
    for (const item of queued) {
      // eslint-disable-next-line no-await-in-loop
      await handleQueueDownloadOne(item);
    }
  };

  const handleAlbumDownloadFull = (album) => {
    (album.tracks || []).forEach(track => {
      if (!isInQueue(track, track.sourceUrl)) {
        addToQueue(track, track.sourceUrl, { albumId: album.id, albumTitle: album.title });
      }
    });
    setOpenAlbum(null);
    setQueueOpen(true);
  };

  const handleAddSoundCloud = async () => {
    if (!pastedUrl.trim() || loadingTrack) return;

    // Album / playlist URL → dedicated album flow (single tracks fall through).
    const urlType = detectUrlType(pastedUrl);
    if (urlType && (urlType.type === 'album' || urlType.type === 'playlist')) {
      handleAlbumDownload(urlType);
      return;
    }

    // Check if electron API is available
    if (!window.electron || !window.electron.addSoundCloud) {
      alert('Error: Electron API not available. Please run this app in Electron, not in a regular browser.');
      console.error('window.electron is not available');
      return;
    }

    setLoadingTrack(true);
    try {
      const track = await window.electron.addSoundCloud(pastedUrl);
      console.log('Track received:', track);
      console.log('Track BPM:', track.bpm, 'Track Key:', track.key);
      setTracks(prev => [...prev, track]);
      setPastedUrl('');
      // Fire-and-forget: fills in format/size/date/key once enrichment resolves.
      enrichTrack(track);
    } catch (err) {
      let errorMessage = 'Failed to load SoundCloud track';
      if (err.message) {
        if (err.message.includes('ffmpeg') || err.message.includes('ffprobe')) {
          errorMessage = 'ffmpeg is required but not found. Please install ffmpeg:\n\n' +
            'macOS: brew install ffmpeg\n' +
            'Linux: sudo apt install ffmpeg (or your package manager)\n' +
            'Windows: Download from https://ffmpeg.org/download.html';
        } else {
          errorMessage = 'Failed to load SoundCloud track: ' + err.message;
        }
      }
      alert(errorMessage);
      console.error(err);
    } finally {
      setLoadingTrack(false);
    }
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const cleanupFunctions = [];

    tracks.forEach(track => {
      if (audioRefs.current[track.id]) {
        const audio = audioRefs.current[track.id];

        const handleLoadedMetadata = () => {
          setTracks(prev => prev.map(t =>
            t.id === track.id
              ? { ...t, duration: audio.duration }
              : t
          ));
        };

        const updateProgress = () => {
          setTracks(prev => prev.map(t =>
            t.id === track.id
              ? { ...t, currentTime: audio.currentTime }
              : t
          ));
        };

        const handleEnded = () => {
          setPlayingTrack(null);
          setTracks(prev => prev.map(t =>
            t.id === track.id
              ? { ...t, currentTime: 0 }
              : t
          ));
        };

        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('ended', handleEnded);

        cleanupFunctions.push(() => {
          audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
          audio.removeEventListener('timeupdate', updateProgress);
          audio.removeEventListener('ended', handleEnded);
        });
      }
    });

    return () => {
      cleanupFunctions.forEach(cleanup => cleanup());
    };
  }, [tracks]);

  const toggleSelect = (id) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const handleRemoveTrack = (id) => {
    // Stop playing if this track is playing
    if (playingTrack === id) {
      if (audioRefs.current[id]) {
        audioRefs.current[id].pause();
      }
      setPlayingTrack(null);
    }

    // Remove from selected if selected
    const newSelected = new Set(selected);
    newSelected.delete(id);
    setSelected(newSelected);

    // Remove audio ref
    if (audioRefs.current[id]) {
      delete audioRefs.current[id];
    }

    // Remove from tracks
    setTracks(prev => prev.filter(t => t.id !== id));
  };

  const handlePlay = async (id) => {
    Object.keys(audioRefs.current).forEach(key => {
      if (parseInt(key) !== id && audioRefs.current[key]) {
        audioRefs.current[key].pause();
      }
    });

    if (playingTrack === id) {
      if (audioRefs.current[id]) {
        audioRefs.current[id].pause();
      }
      setPlayingTrack(null);
    } else {
      if (audioRefs.current[id]) {
        try {
          await audioRefs.current[id].play();
          setPlayingTrack(id);
        } catch (err) {
          console.error('Error playing audio:', err);
          alert('Error playing track. Make sure the file exists.');
        }
      }
    }
  };

  const handleProgressClick = (e, track) => {
    if (!audioRefs.current[track.id]) return;

    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = percentage * track.duration;

    audioRefs.current[track.id].currentTime = newTime;
    setTracks(prev => prev.map(t =>
      t.id === track.id
        ? { ...t, currentTime: newTime }
        : t
    ));
  };

  // Fire-and-forget macOS trackpad haptic. Silent no-op off-macOS or when the
  // IPC isn't bridged (older preload / no Swift tooling).
  const triggerHaptic = (type) => {
    try {
      window.electron?.triggerHaptic?.(type);
    } catch (err) {
      /* never let haptics break scrubbing */
    }
  };

  const handleProgressMouseDown = (e, track) => {
    if (!audioRefs.current[track.id]) return;

    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();

    const updateProgress = (clientX) => {
      const clickX = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clickX / rect.width));
      const newTime = percentage * track.duration;

      audioRefs.current[track.id].currentTime = newTime;
      setTracks(prev => prev.map(t =>
        t.id === track.id
          ? { ...t, currentTime: newTime }
          : t
      ));
    };

    // Strong "snap" on press.
    triggerHaptic('levelChange');
    updateProgress(e.clientX);

    // Subtle ticks while dragging, throttled to ~50ms to avoid spamming.
    let lastHaptic = 0;
    const handleMouseMove = (moveEvent) => {
      updateProgress(moveEvent.clientX);
      const now = Date.now();
      if (now - lastHaptic > 50) {
        triggerHaptic('alignment');
        lastHaptic = now;
      }
    };

    const handleMouseUp = () => {
      // Strong "snap" on release.
      triggerHaptic('levelChange');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Setup download progress listener
  useEffect(() => {
    if (window.electron && window.electron.onDownloadProgress) {
      window.electron.onDownloadProgress((progress) => {
        downloadProgressRef.current = progress;
        setDownloadProgress(progress);
      });
    }

    return () => {
      if (window.electron && window.electron.removeDownloadProgressListener) {
        window.electron.removeDownloadProgressListener();
      }
    };
  }, []);

  const handleDownload = async () => {
    if (selected.size === 0 || downloading) return;

    setDownloading(true);
    setDownloadProgress(0);
    downloadProgressRef.current = 0;
    try {
      const trackIds = Array.from(selected);

      // Wait for progress to reach 100% before showing success
      const waitForProgress = () => {
        return new Promise((resolve) => {
          const checkProgress = () => {
            if (downloadProgressRef.current >= 100) {
              // Wait a bit more for animation to complete
              setTimeout(() => resolve(), 300);
            } else {
              setTimeout(checkProgress, 50);
            }
          };
          checkProgress();
        });
      };

      // Start download
      const downloadPromise = window.electron.downloadTracks(trackIds, tracks);

      // Wait for download to complete
      const result = await downloadPromise;

      // Wait for progress to reach 100%
      await waitForProgress();

      if (result.success) {
        alert(`Download successful! File saved to Downloads folder.`);
        setSelected(new Set());
      }
    } catch (err) {
      alert('Download failed: ' + (err.message || 'Unknown error'));
      console.error(err);
    } finally {
      setDownloading(false);
      // Keep progress at 100% for a moment before resetting
      setTimeout(() => {
        setDownloadProgress(0);
        downloadProgressRef.current = 0;
      }, 500);
    }
  };

  // Toggle Select All / Deselect All
  const handleToggleSelectAll = () => {
    if (selected.size === tracks.length) {
      // All selected, deselect all
      setSelected(new Set());
    } else {
      // Not all selected, select all
      const allIds = new Set(tracks.map(t => t.id));
      setSelected(allIds);
    }
  };

  // Filter and sort tracks
  const getFilteredAndSortedTracks = () => {
    let filtered = [...tracks];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(track =>
        track.title?.toLowerCase().includes(query) ||
        track.artist?.toLowerCase().includes(query) ||
        track.bpm?.toString().includes(query)
      );
    }

    // Apply BPM filter
    if (filterBpmMin) {
      const min = parseInt(filterBpmMin);
      filtered = filtered.filter(track => track.bpm && track.bpm >= min);
    }
    if (filterBpmMax) {
      const max = parseInt(filterBpmMax);
      filtered = filtered.filter(track => track.bpm && track.bpm <= max);
    }

    // Apply artist filter
    if (filterArtist.trim()) {
      const artist = filterArtist.toLowerCase();
      filtered = filtered.filter(track => track.artist?.toLowerCase().includes(artist));
    }

    // Sort tracks
    filtered.sort((a, b) => {
      let aVal, bVal;

      switch (sortBy) {
        case 'bpm':
          aVal = a.bpm || 0;
          bVal = b.bpm || 0;
          break;
        case 'title':
          aVal = a.title || '';
          bVal = b.title || '';
          break;
        case 'artist':
          aVal = a.artist || '';
          bVal = b.artist || '';
          break;
        case 'duration':
          aVal = a.duration || 0;
          bVal = b.duration || 0;
          break;
        default:
          aVal = a.title || '';
          bVal = b.title || '';
      }

      if (typeof aVal === 'string') {
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      } else {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
    });

    return filtered;
  };

  /* Inspector edits: additive UI-layer fields merged onto the track object.
     Existing data shape is never destructively changed; saveTracks untouched. */
  const updateTrackField = (id, field, value) => {
    setTracks(prev => prev.map(t => (t.id === id ? { ...t, [field]: value } : t)));
  };

  /* ===== Derived view data ===== */
  const filtered = getFilteredAndSortedTracks();
  // Main shelf = album cards + standalone tracks, newest first. Album tracks
  // live inside album.tracks and never enter `tracks`/`filtered`.
  const shelfItems = [
    ...albums.map(a => ({ ...a, _type: 'album' })),
    ...filtered.map(t => ({ ...t, _type: 'track' })),
  ].sort((a, b) => {
    const da = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
    const db = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
    return db - da;
  });
  const focusIdx = shelfItems.length ? clamp(0, shelfItems.length - 1, selectedIndex) : -1;
  const focused = focusIdx >= 0 ? shelfItems[focusIdx] : null;
  const focusedTrack = focused && focused._type !== 'album' ? focused : null;
  const focusedAlbum = focused && focused._type === 'album' ? focused : null;
  const isLibrary = view === 'library';
  const shelfVisible = isLibrary && shelfItems.length > 0;

  const focusTo = (i) => {
    // Animate to the target: nudge targetRef only and let the rAF loop ease
    // curRef toward it (smooth scroll). The loop updates the focused index as
    // it crosses/lands on records — no instant snap.
    targetRef.current = clamp(0, Math.max(0, filteredLenRef.current - 1), i);
  };

  // Keep rAF-loop refs in sync with the latest render (read inside the loop).
  useEffect(() => {
    filteredLenRef.current = shelfItems.length;
    actionsRef.current.togglePlayFocused = () => {
      if (focusedTrack) handlePlay(focusedTrack.id);
      else if (focusedAlbum) setOpenAlbum(focusedAlbum);
    };
  });

  /* Lazy artwork backfill: when a track without artwork becomes focused (e.g.
     an older library entry saved before artwork extraction existed), pull its
     embedded cover once. Keyed on the focused id so it runs once per track and
     never loops once artwork is set. */
  useEffect(() => {
    if (!focusedTrack || focusedTrack.artwork) return undefined;
    const filePath = focusedTrack.filePath || focusedTrack.path;
    if (!filePath || !window.electron || !window.electron.extractArtwork) return undefined;
    let cancelled = false;
    const fid = focusedTrack.id;
    window.electron
      .extractArtwork(filePath)
      .then(result => {
        if (!cancelled && result && result.artwork) {
          setTracks(prev => prev.map(t => (t.id === fid ? { ...t, artwork: result.artwork } : t)));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [focusedTrack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // TEMP DIAGNOSTIC — remove once artwork is confirmed. Reveals (a) whether the
  // running app's preload exposes the extractArtwork IPC (undefined ⇒ Electron
  // needs a full restart, not just a window reload), and (b) the artwork shape.
  useEffect(() => {
    if (!focused) return;
    console.log(
      '[artwork] extractArtwork IPC:', typeof window.electron?.extractArtwork,
      '| value:', focused.artwork ? String(focused.artwork).slice(0, 32) + '…' : focused.artwork,
      '| type:', typeof focused.artwork
    );
  }, [focused?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 3D shelf animation loop + input listeners. Re-attaches when the shelf
     mounts/unmounts. rAF and listeners are torn down on cleanup (no leaks). */
  useEffect(() => {
    if (!shelfVisible) return undefined;

    // Clamp persisted scroll position into range for the current list.
    const maxI = Math.max(0, filteredLenRef.current - 1);
    curRef.current = clamp(0, maxI, curRef.current);
    targetRef.current = clamp(0, maxI, targetRef.current);

    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      curRef.current += (targetRef.current - curRef.current) * Math.min(1, dt * 9);
      const scene = sceneRef.current;
      if (scene) {
        const cards = scene.querySelectorAll('[data-card]');
        for (let k = 0; k < cards.length; k++) {
          const el = cards[k];
          const i = +el.dataset.index;
          const d = i - curRef.current;
          const ad = Math.abs(d);
          const focus = Math.max(0, 1 - ad);
          // Tunnel layout (the only shelf mode).
          const ty = -d * 134;
          const tz = 62 - ad * 250;
          const rx = 52 - focus * 15;
          const sc = (1 - Math.min(0.52, ad * 0.052)) * (1 + focus * 0.03);
          const tf = `translate3d(0,${ty}px,${tz}px) rotateX(${rx}deg) scale(${sc})`;
          const op = Math.max(0.04, Math.min(1, 1.16 - ad * 0.17));
          el.style.transform = tf;
          el.style.opacity = op;
          el.style.filter = ad > 2.5 ? `blur(${Math.min(5, (ad - 2.5) * 2.1)}px)` : 'none';
          // Authoritative paint order: nearer the focus ⇒ higher z-index. The
          // scene is now a flat stacking context (no preserve-3d), so z-index —
          // not 3D position — decides which card paints on top. Strictly
          // monotonic in `ad`, so the focused card is always frontmost and no
          // card ever paints in front of one visually closer to the viewer.
          el.style.zIndex = String(10000 - Math.round(ad * 100));
          // Only visibly-sharp cards intercept clicks: keeps click-to-pull for
          // near cards while preventing phantom hits from faded/back cards.
          el.style.pointerEvents = ad < 2.5 ? 'auto' : 'none';
        }
      }

      const len = filteredLenRef.current;
      const c = clamp(0, Math.max(0, len - 1), Math.round(curRef.current));
      if (c !== lastCRef.current) {
        lastCRef.current = c;
        setSelectedIndex(c);
        // One haptic per record change (never per scroll tick). First/last
        // record get a firmer "edge snap"; everything between is a subtle tick.
        const atEdge = c === 0 || c === Math.max(0, len - 1);
        triggerHaptic(atEdge ? 'levelChange' : 'alignment');
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    const stage = stageRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const max = Math.max(0, filteredLenRef.current - 1);
      targetRef.current = clamp(0, max, targetRef.current + e.deltaY * 0.0055);
    };
    const onKey = (e) => {
      const max = Math.max(0, filteredLenRef.current - 1);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        targetRef.current = Math.min(max, Math.round(targetRef.current) + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        targetRef.current = Math.max(0, Math.round(targetRef.current) - 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        actionsRef.current.togglePlayFocused();
      }
    };

    if (stage) stage.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);

    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (stage) stage.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [shelfVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Now-playing / inspector progress derived from real audio state. */
  const npProgress =
    focusedTrack && focusedTrack.duration > 0 ? (focusedTrack.currentTime || 0) / focusedTrack.duration : 0;
  const focusedColor = focused ? colorFor(focused.id, focusIdx) : { frame: '#1a1a1d', ink: '#fff' };
  const isFocusedPlaying = focusedTrack && playingTrack === focusedTrack.id;
  const isFocusedSelected = focusedTrack && selected.has(focusedTrack.id);
  const waveBars = makeBars((focusIdx >= 0 ? focusIdx : 0) + 1, 58);

  const stub = null;

  /* Inspector BPM/KEY stat cards — fixed size so they never resize with
     content (e.g. "F# min" vs "128"). Both cards identical; value never wraps. */
  const statCardStyle = (bg, border) => ({
    flex: 1,
    height: '96px',
    minHeight: '96px',
    maxHeight: '96px',
    boxSizing: 'border-box',
    padding: '14px',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    background: bg,
    border: `1px solid ${border}`,
  });
  const statValueStyle = {
    fontFamily: MONO,
    fontSize: 'clamp(20px, 2.2vw, 28px)',
    fontWeight: 600,
    lineHeight: 1,
    marginTop: '6px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  // Monospace metadata pill for album cards (muted when the value is absent).
  const statPill = (muted) => ({
    fontSize: '10px',
    fontFamily: MONO,
    color: muted ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.06)',
    padding: '2px 6px',
    borderRadius: '4px',
  });

  /* Shared small style helpers */
  const fieldStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${LINE}`,
    color: '#fff',
    borderRadius: '8px',
    padding: '8px 11px',
    fontSize: '12px',
    fontFamily: MONO,
    outline: 'none',
  };

  const metaRows = focusedTrack
    ? [
        { k: 'DURATION', v: formatTime(focusedTrack.duration) },
        { k: 'KEY', v: focusedTrack.key || '—' },
        { k: 'GENRE', v: focusedTrack.genre || '—' },
        { k: 'FILE SIZE', v: focusedTrack.fileSize || '—' },
        { k: 'FORMAT', v: focusedTrack.format || '—' },
        { k: 'SOURCE', v: sourceLabel(focusedTrack.source) },
        { k: 'DATE ADDED', v: focusedTrack.dateAdded ? new Date(focusedTrack.dateAdded).toLocaleDateString() : '—' },
      ]
    : [];

  // Wire audio progress for the currently-open album's tracks (inner shelf).
  // Reuses audioRefs/handlePlay/playingTrack; progress lives in albumTimes so
  // the main `tracks` state is never touched by album playback.
  useEffect(() => {
    if (!openAlbum || !openAlbum.tracks) return undefined;
    const cleanups = [];
    openAlbum.tracks.forEach(track => {
      const audio = audioRefs.current[track.id];
      if (!audio) return;
      const onMeta = () => setAlbumTimes(prev => ({ ...prev, [track.id]: { ...prev[track.id], duration: audio.duration } }));
      const onTime = () => setAlbumTimes(prev => ({ ...prev, [track.id]: { ...prev[track.id], currentTime: audio.currentTime } }));
      const onEnded = () => {
        setPlayingTrack(null);
        setAlbumTimes(prev => ({ ...prev, [track.id]: { ...prev[track.id], currentTime: 0 } }));
      };
      audio.addEventListener('loadedmetadata', onMeta);
      audio.addEventListener('timeupdate', onTime);
      audio.addEventListener('ended', onEnded);
      cleanups.push(() => {
        audio.removeEventListener('loadedmetadata', onMeta);
        audio.removeEventListener('timeupdate', onTime);
        audio.removeEventListener('ended', onEnded);
      });
    });
    return () => cleanups.forEach(fn => fn());
  }, [openAlbum]);

  const handleAlbumSeek = (e, track) => {
    const audio = audioRefs.current[track.id];
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const dur = track.duration || (albumTimes[track.id] && albumTimes[track.id].duration) || 0;
    audio.currentTime = pct * dur;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: '1fr 338px',
        background: 'var(--bg)',
        color: INK,
        fontFamily: "'Space Grotesk', -apple-system, sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* macOS traffic light drag region */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '48px',
          WebkitAppRegion: 'drag',
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      >
        {/* Allow clicks on buttons/inputs by making them draggable */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '90px', // After traffic lights (15 + 3*20 + padding)
            right: 0,
            bottom: 0,
            WebkitAppRegion: 'no-drag',
            pointerEvents: 'auto',
          }}
        />
      </div>

      {/* Hidden audio elements (one per track) */}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        {tracks.map(track => (
          <audio
            key={track.id}
            ref={el => {
              if (el) {
                audioRefs.current[track.id] = el;
                el.addEventListener('error', (e) => {
                  console.error('Audio load error:', e);
                  setTracks(prev => prev.map(t =>
                    t.id === track.id ? { ...t, error: true } : t
                  ));
                });
              }
            }}
            src={track.url}
            preload="metadata"
            crossOrigin="anonymous"
          />
        ))}
      </div>

      {/* ===================== MAIN ===================== */}
      <main
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          background: 'radial-gradient(120% 80% at 50% 8%, #131216 0%, #0a0a0c 52%, #060607 100%)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            padding: '18px 26px',
            paddingTop: '58px', // Space for macOS traffic lights
            borderBottom: `1px solid ${LINE}`,
            zIndex: 20,
            background: 'rgba(8,8,10,0.4)',
            backdropFilter: 'blur(8px)',
          }}
        >
          {/* Inline library status (flush — no card container) */}
          <div style={{ minWidth: '240px', maxWidth: '440px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '16px' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '0.3px' }}>LIBRARY</span>
              <span style={{ fontFamily: MONO, fontSize: '12px', color: ACCENT }}>{tracks.length} TRACKS</span>
            </div>
            <div style={{ height: '5px', borderRadius: '5px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginTop: '7px' }}>
              <div style={{ width: `${Math.min(100, tracks.length * 6)}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),#caa055)' }} />
            </div>
            <div style={{ fontFamily: MONO, fontSize: '10px', color: FAINT, marginTop: '6px', letterSpacing: '0.5px' }}>
              {selected.size} SELECTED · LOCAL DISK
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              onClick={() => setDownloadOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '13px',
                fontWeight: 500,
                padding: '8px 15px',
                borderRadius: '9px',
                background: ACCENT,
                color: '#1a1407',
                boxShadow: `0 4px 16px ${ACCENT_SOFT}`,
              }}
            >
              <span style={{ fontSize: '15px', lineHeight: 1, marginTop: '-1px' }}>+</span> Download
            </button>
            <button
              onClick={() => setView(view === 'settings' ? 'library' : 'settings')}
              title="Settings"
              aria-label="Settings"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '36px',
                height: '36px',
                border: `1px solid ${LINE}`,
                background: view === 'settings' ? ACCENT_SOFT : 'rgba(255,255,255,0.04)',
                color: view === 'settings' ? ACCENT : DIM,
                borderRadius: '9px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {ICONS.settings}
            </button>
          </div>
        </header>

        {/* Search / filter / sort toolbar (library only) */}
        {isLibrary && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 26px',
              borderBottom: `1px solid ${LINE}`,
              flexWrap: 'wrap',
              zIndex: 20,
              background: 'rgba(8,8,10,0.35)',
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tracks…"
              style={{ ...fieldStyle, flex: 1, minWidth: '160px' }}
            />
            <input
              type="number"
              value={filterBpmMin}
              onChange={(e) => setFilterBpmMin(e.target.value)}
              placeholder="BPM MIN"
              style={{ ...fieldStyle, width: '92px' }}
            />
            <input
              type="number"
              value={filterBpmMax}
              onChange={(e) => setFilterBpmMax(e.target.value)}
              placeholder="BPM MAX"
              style={{ ...fieldStyle, width: '92px' }}
            />
            <input
              type="text"
              value={filterArtist}
              onChange={(e) => setFilterArtist(e.target.value)}
              placeholder="Artist"
              style={{ ...fieldStyle, width: '120px' }}
            />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ ...fieldStyle }}>
              <option value="title" style={{ background: '#1a1a1a' }}>TITLE</option>
              <option value="artist" style={{ background: '#1a1a1a' }}>ARTIST</option>
              <option value="bpm" style={{ background: '#1a1a1a' }}>BPM</option>
              <option value="duration" style={{ background: '#1a1a1a' }}>DURATION</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              style={{ ...fieldStyle, cursor: 'pointer', color: ACCENT }}
            >
              {sortOrder === 'asc' ? '↑ ASC' : '↓ DESC'}
            </button>
            <button
              onClick={handleToggleSelectAll}
              style={{
                ...fieldStyle,
                cursor: 'pointer',
                color: selected.size === tracks.length && tracks.length ? '#1a1407' : '#fff',
                background: selected.size === tracks.length && tracks.length ? ACCENT : 'rgba(255,255,255,0.04)',
              }}
            >
              {selected.size === tracks.length && tracks.length ? 'DESELECT ALL' : 'SELECT ALL'}
            </button>
          </div>
        )}

        {/* ===== Library shelf ===== */}
        {shelfVisible && (
          <div
            ref={stageRef}
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <div
              ref={sceneRef}
              style={{
                position: 'absolute',
                inset: 0,
                // Perspective lives here (the cards' direct parent) and the scene
                // is left as a *flat* stacking context (no preserve-3d) so paint
                // order follows z-index rather than 3D Z. `isolation: isolate`
                // keeps card z-indices from leaking into sibling UI.
                perspective: '1750px',
                perspectiveOrigin: '50% 33%',
                isolation: 'isolate',
              }}
            >
              {shelfItems.map((item, i) => {
                const isAlbum = item._type === 'album';
                const c = colorFor(item.id, i);
                const prog = isAlbum ? albumProgress[item.id] : null;
                const downloading = isAlbum && prog && !prog.done;
                const albumCount = item.trackCount || (item.tracks ? item.tracks.length : 0);
                const dlText = downloading
                  ? (prog.total ? `DOWNLOADING ${prog.current || 0}/${prog.total}…` : 'DOWNLOADING…')
                  : null;
                return (
                  <div
                    key={(isAlbum ? 'album-' : 'track-') + item.id}
                    data-card="1"
                    data-index={i}
                    onClick={() => {
                      triggerHaptic('levelChange');
                      if (isAlbum) setOpenAlbum(item);
                      else focusTo(i);
                    }}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '43%',
                      width: '466px',
                      height: '288px',
                      margin: '-144px 0 0 -233px',
                      cursor: 'pointer',
                      willChange: 'transform, opacity, z-index',
                    }}
                  >
                    {/* Flat "stacked vinyl" edge — 2D offsets (not translateZ) so
                        the card stays a flat layer and never z-fights neighbours. */}
                    <div style={{ position: 'absolute', inset: 0, transform: 'translateY(8px) scale(0.97)', background: '#050506', borderRadius: '13px', boxShadow: '0 50px 90px rgba(0,0,0,0.7)' }} />
                    <div style={{ position: 'absolute', inset: 0, transform: 'translateY(4px) scale(0.985)', background: `color-mix(in srgb, ${c.frame} 55%, #000)`, borderRadius: '13px' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '13px', overflow: 'hidden', background: c.frame, border: '1px solid rgba(255,255,255,0.12)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)' }}>
                      {!isAlbum && isInQueue(item, item.sourceUrl) && (
                        <span title="In Queue" style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2, fontSize: '12px', background: 'rgba(0,0,0,0.6)', borderRadius: '4px', padding: '2px 4px', pointerEvents: 'none' }}>🗂</span>
                      )}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', padding: '13px 18px 11px', color: c.ink }}>
                        <span style={{ fontWeight: 700, fontSize: '17px', letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
                        <span style={{ fontSize: '14px', opacity: 0.72, whiteSpace: 'nowrap' }}>{item.artist}</span>
                        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          {sourceBadge(item.source) && (
                            <span style={{ fontFamily: MONO, fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', color: c.ink, opacity: 0.85, padding: '1px 5px', borderRadius: '4px', border: `1px solid ${c.ink}`, lineHeight: 1.5 }}>
                              {sourceBadge(item.source)}
                            </span>
                          )}
                          <span style={{ fontFamily: MONO, fontSize: '11px', opacity: 0.62, whiteSpace: 'nowrap' }}>
                            {isAlbum
                              ? (downloading ? dlText : (item.source === 'soundcloud' ? 'PLAYLIST' : 'ALBUM'))
                              : `${item.bpm ? `${item.bpm} BPM` : '—'}${item.key ? ` · ${item.key}` : ''}`}
                          </span>
                        </span>
                      </div>
                      <div style={{ position: 'absolute', left: '14px', right: '14px', bottom: '14px', top: '46px', borderRadius: '8px', overflow: 'hidden', background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.13) 0 11px, rgba(0,0,0,0.05) 11px 22px)' }}>
                        {item.artwork ? (
                          <img src={item.artwork} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <ArtPlaceholder radius={8} label={isAlbum ? 'album' : 'album art'} />
                        )}
                        {isAlbum && (
                          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px 12px', background: 'linear-gradient(to top, rgba(0,0,0,0.78), transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.5px', color: '#fff' }}>
                            <span>{downloading ? dlText : `${albumCount} TRACKS`}</span>
                            <span style={{ opacity: 0.8 }}>{downloading ? '' : 'CLICK TO OPEN'}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Vignette */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                background:
                  'linear-gradient(to bottom, transparent 58%, rgba(6,6,7,0.82) 86%, #060607 99%), radial-gradient(115% 72% at 50% 38%, transparent 50%, rgba(6,6,7,0.5) 84%, rgba(6,6,7,0.9) 100%)',
              }}
            />

            {/* Now-playing dock */}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: '26px', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 30 }}>
              <div
                style={{
                  pointerEvents: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  width: '660px',
                  maxWidth: 'calc(100% - 40px)',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  padding: '11px 16px',
                  borderRadius: '16px',
                  background: 'rgba(14,14,17,0.82)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  boxShadow: '0 18px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
                }}
              >
                <AlbumArt track={focused} size={46} radius={9} />
                <div style={{ flex: '0 1 130px', minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{focused ? focused.title : '—'}</div>
                  <div style={{ fontSize: '11.5px', color: DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{focused ? focused.artist : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 'none', flexShrink: 0 }}>
                  <button onClick={() => focusTo(Math.max(0, focusIdx - 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: DIM, display: 'flex', padding: '4px' }}>{ICONS.prev}</button>
                  <button
                    onClick={() => {
                      if (focusedTrack) handlePlay(focusedTrack.id);
                      else if (focusedAlbum) setOpenAlbum(focusedAlbum);
                    }}
                    style={{ width: '38px', height: '38px', borderRadius: '50%', border: 'none', cursor: 'pointer', background: ACCENT, color: '#1a1407', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 18px ${ACCENT_SOFT}`, flexShrink: 0 }}
                  >
                    {isFocusedPlaying ? ICONS.pause : ICONS.play}
                  </button>
                  <button onClick={() => focusTo(Math.min(shelfItems.length - 1, focusIdx + 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: DIM, display: 'flex', padding: '4px' }}>{ICONS.next}</button>
                </div>
                <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: MONO, fontSize: '10.5px', color: DIM, width: '36px', flexShrink: 0, textAlign: 'right' }}>{focusedTrack ? formatTime(focusedTrack.currentTime) : '0:00'}</span>
                  <div
                    onMouseDown={(e) => focusedTrack && handleProgressMouseDown(e, focusedTrack)}
                    onClick={(e) => focusedTrack && handleProgressClick(e, focusedTrack)}
                    style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, height: '30px', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: '1.5px', cursor: 'pointer' }}
                  >
                    {waveBars.map((h, bi) => (
                      <div key={bi} style={{ flex: 1, minWidth: '1px', borderRadius: '1.5px', background: ACCENT, height: `${h}%`, opacity: 0.92 }} />
                    ))}
                    <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, left: `${npProgress * 100}%`, background: 'rgba(13,13,16,0.66)', borderRadius: '3px', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: '-2px', bottom: '-2px', left: `${npProgress * 100}%`, width: '2px', background: '#fff', boxShadow: '0 0 8px rgba(255,255,255,0.6)', pointerEvents: 'none' }} />
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: '10.5px', color: DIM, width: '36px', flexShrink: 0 }}>{focusedTrack ? formatTime(focusedTrack.duration) : '0:00'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 'none', flexShrink: 0, padding: '5px 11px', borderRadius: '9px', background: ACCENT_SOFT, border: '1px solid rgba(230,178,76,0.2)' }}>
                  <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: '15px', color: ACCENT, lineHeight: 1 }}>{focusedTrack && focusedTrack.bpm ? focusedTrack.bpm : '—'}</span>
                  <span style={{ fontFamily: MONO, fontSize: '8.5px', color: ACCENT, opacity: 0.7, letterSpacing: '0.5px' }}>BPM</span>
                </div>
              </div>
            </div>

            <div style={{ position: 'absolute', left: 0, right: 0, top: '18px', textAlign: 'center', pointerEvents: 'none', fontFamily: MONO, fontSize: '10px', letterSpacing: '2px', color: FAINT }}>
              ↑ &nbsp;DIGGING THROUGH {shelfItems.length} RECORDS&nbsp; ↓
            </div>
          </div>
        )}

        {/* ===== Library empty state ===== */}
        {isLibrary && shelfItems.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', animation: 'ilm-rise .35s ease' }}>
            <div style={{ width: '74px', height: '74px', borderRadius: '18px', border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT, background: 'rgba(255,255,255,0.02)' }}>{ICONS.library}</div>
            <div style={{ textAlign: 'center', maxWidth: '380px' }}>
              <div style={{ fontSize: '21px', fontWeight: 600, letterSpacing: '-0.3px' }}>
                {tracks.length === 0 ? 'Your shelf is empty' : 'No records match'}
              </div>
              <div style={{ color: DIM, fontSize: '13.5px', marginTop: '8px', lineHeight: 1.55 }}>
                {tracks.length === 0
                  ? 'Paste a SoundCloud or Spotify link to fetch art, metadata & BPM, then dig through your collection spatially.'
                  : 'Adjust your search or filters to bring records back to the shelf.'}
              </div>
            </div>
            {tracks.length === 0 && (
              <button onClick={() => setDownloadOpen(true)} style={{ border: `1px solid ${LINE}`, background: 'transparent', color: INK, cursor: 'pointer', fontFamily: MONO, fontSize: '11px', letterSpacing: '1px', padding: '9px 18px', borderRadius: '9px' }}>
                + ADD YOUR FIRST RECORD
              </button>
            )}
          </div>
        )}

        {/* ===== Tool / settings stub views ===== */}
        {!isLibrary && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', animation: 'ilm-rise .35s ease', padding: '0 32px' }}>
            <div style={{ width: '74px', height: '74px', borderRadius: '18px', border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT, background: 'rgba(255,255,255,0.02)' }}>
              {stub ? stub.icon : ICONS.settings}
            </div>
            <div style={{ textAlign: 'center', maxWidth: '420px' }}>
              <div style={{ fontSize: '21px', fontWeight: 600, letterSpacing: '-0.3px' }}>{stub ? stub.title : 'Settings'}</div>
              <div style={{ color: DIM, fontSize: '13.5px', marginTop: '8px', lineHeight: 1.55 }}>
                {stub
                  ? stub.body
                  : 'Download quality, audio engine, library paths, and metadata write-back. Local-first — nothing leaves this machine.'}
              </div>
            </div>
            {view === 'settings' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: '#fff', textAlign: 'center' }}>
                  MADE BY LOVE ILOVEMUSIC ❤️ RIPO
                </div>
                <a
                  href="https://www.instagram.com/cactusdomain/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: MONO, fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', padding: '11px 28px', border: `1px solid ${ACCENT}`, background: ACCENT_SOFT, color: ACCENT, textDecoration: 'none', borderRadius: '9px' }}
                >
                  @CACTUSDOMAIN
                </a>
                <div style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '1.5px', color: FAINT, marginTop: '4px' }}>
                  ILOVEMUSIC · LOCAL · v3.0
                </div>
              </div>
            )}
            <button onClick={() => setView('library')} style={{ border: `1px solid ${LINE}`, background: 'transparent', color: INK, cursor: 'pointer', fontFamily: MONO, fontSize: '11px', letterSpacing: '1px', padding: '9px 18px', borderRadius: '9px' }}>
              ← BACK TO SHELF
            </button>
          </div>
        )}
      </main>

      {/* ===================== RIGHT INSPECTOR ===================== */}
      <aside style={{ display: 'flex', flexDirection: 'column', background: PANEL, borderLeft: `1px solid ${LINE}`, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 22px 14px', paddingTop: '58px' }}>
          <div style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '1.6px', color: FAINT }}>INSPECTOR</div>
          {focusedTrack && (
            <button
              onClick={() => setEditing(e => !e)}
              style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, background: editing ? ACCENT : 'transparent', color: editing ? '#1a1407' : DIM, cursor: 'pointer', fontFamily: MONO, fontSize: '10px', letterSpacing: '1px', padding: '5px 11px', borderRadius: '7px' }}
            >
              {editing ? 'DONE' : 'EDIT'}
            </button>
          )}
        </div>

        {!focused ? (
          <div style={{ padding: '40px 22px', color: DIM, fontSize: '13px', textAlign: 'center', lineHeight: 1.6 }}>
            Pull a record from the shelf to inspect its metadata.
          </div>
        ) : focusedAlbum ? (
          <div style={{ padding: '0 22px 22px' }}>
            <div style={{ borderRadius: '13px', overflow: 'hidden', aspectRatio: '1 / 1', background: focusedColor.frame, border: `1px solid ${LINE}`, boxShadow: '0 16px 36px rgba(0,0,0,0.45)', position: 'relative' }}>
              {focusedAlbum.artwork ? (
                <img src={focusedAlbum.artwork} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <ArtPlaceholder radius={0} label="album" />
              )}
            </div>
            <div style={{ marginTop: '18px' }}>
              <div style={{ fontSize: '21px', fontWeight: 700, letterSpacing: '-0.4px', lineHeight: 1.15 }}>{focusedAlbum.title}</div>
              <div style={{ fontSize: '14px', color: DIM, marginTop: '4px' }}>{focusedAlbum.artist}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.5px', color: DIM, padding: '5px 10px', borderRadius: '20px', border: `1px solid ${LINE}`, background: 'rgba(255,255,255,0.02)' }}>{sourceLabel(focusedAlbum.source)}</span>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.5px', color: DIM, padding: '5px 10px', borderRadius: '20px', border: `1px solid ${LINE}`, background: 'rgba(255,255,255,0.02)' }}>
                {(focusedAlbum.trackCount || (focusedAlbum.tracks ? focusedAlbum.tracks.length : 0))} TRACKS
              </span>
              {albumProgress[focusedAlbum.id] && !albumProgress[focusedAlbum.id].done && (
                <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.5px', color: ACCENT, padding: '5px 10px', borderRadius: '20px', border: '1px solid rgba(230,178,76,0.3)', background: ACCENT_SOFT }}>
                  {albumProgress[focusedAlbum.id].total
                    ? `DOWNLOADING ${albumProgress[focusedAlbum.id].current || 0}/${albumProgress[focusedAlbum.id].total}…`
                    : 'DOWNLOADING…'}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpenAlbum(focusedAlbum)}
              style={{ width: '100%', marginTop: '18px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, padding: '12px', borderRadius: '10px', background: ACCENT, color: '#1a1407' }}
            >
              Open Album →
            </button>
            <button
              onClick={() => {
                const id = focusedAlbum.id;
                setAlbums(prev => prev.filter(a => a.id !== id));
                if (openAlbum && openAlbum.id === id) setOpenAlbum(null);
              }}
              style={{ width: '100%', marginTop: '10px', border: '1px solid rgba(255,80,80,0.2)', background: 'transparent', color: '#e87a7a', cursor: 'pointer', fontFamily: MONO, fontSize: '10.5px', letterSpacing: '1px', padding: '9px', borderRadius: '9px', textTransform: 'uppercase' }}
            >
              ✕ Remove album
            </button>
          </div>
        ) : (
          <div style={{ padding: '0 22px 22px' }}>
            <div style={{ borderRadius: '13px', overflow: 'hidden', aspectRatio: '1 / 1', background: focusedColor.frame, border: `1px solid ${LINE}`, boxShadow: '0 16px 36px rgba(0,0,0,0.45)', position: 'relative' }}>
              {focused.artwork ? (
                <img src={focused.artwork} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <ArtPlaceholder radius={0} label="drop album art" />
              )}
            </div>

            {editing ? (
              <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input value={focused.title || ''} onChange={(e) => updateTrackField(focused.id, 'title', e.target.value)} style={{ ...fieldStyle, fontFamily: 'inherit', fontSize: '15px', fontWeight: 600, border: `1px solid ${ACCENT}` }} />
                <input value={focused.artist || ''} onChange={(e) => updateTrackField(focused.id, 'artist', e.target.value)} style={{ ...fieldStyle, fontFamily: 'inherit', fontSize: '13px', color: DIM }} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input value={focused.bpm || ''} onChange={(e) => updateTrackField(focused.id, 'bpm', e.target.value)} placeholder="BPM" style={{ ...fieldStyle, width: '50%' }} />
                  <input value={focused.key || ''} onChange={(e) => updateTrackField(focused.id, 'key', e.target.value)} placeholder="KEY" style={{ ...fieldStyle, width: '50%' }} />
                </div>
                <input value={focused.genre || ''} onChange={(e) => updateTrackField(focused.id, 'genre', e.target.value)} placeholder="Genre" style={{ ...fieldStyle, fontFamily: 'inherit', fontSize: '13px' }} />
              </div>
            ) : (
              <div style={{ marginTop: '18px' }}>
                <div style={{ fontSize: '21px', fontWeight: 700, letterSpacing: '-0.4px', lineHeight: 1.15 }}>{focused.title}</div>
                <div style={{ fontSize: '14px', color: DIM, marginTop: '4px' }}>{focused.artist}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '18px', alignItems: 'stretch' }}>
              <div style={statCardStyle('rgba(230,178,76,0.07)', 'rgba(230,178,76,0.18)')}>
                <div style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '1px', color: ACCENT, opacity: 0.8 }}>BPM</div>
                <div style={{ ...statValueStyle, color: ACCENT }}>{focused.bpm || '—'}</div>
              </div>
              <div style={statCardStyle('rgba(255,255,255,0.025)', LINE)}>
                <div style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '1px', color: DIM }}>KEY</div>
                <div style={statValueStyle}>{focused.key || '—'}</div>
              </div>
            </div>

            <div style={{ marginTop: '18px', borderTop: `1px solid ${LINE}` }}>
              {metaRows.map(r => (
                <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${LINE}` }}>
                  <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '1px', color: FAINT }}>{r.k}</span>
                  <span style={{ fontFamily: MONO, fontSize: '12px', color: INK }}>{r.v}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
              <button
                onClick={() => toggleSelect(focused.id)}
                style={{ flex: 1, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12.5px', padding: '10px', borderRadius: '9px', background: isFocusedSelected ? ACCENT : 'rgba(255,255,255,0.05)', color: isFocusedSelected ? '#1a1407' : INK }}
              >
                {isFocusedSelected ? 'In Queue ✓' : 'Add to Queue'}
              </button>
              <button
                onClick={handleDownload}
                disabled={selected.size === 0 || downloading}
                title={selected.size === 0 ? 'Add tracks to the queue first' : 'Download selected as ZIP'}
                style={{ flex: 'none', border: `1px solid ${LINE}`, cursor: selected.size === 0 || downloading ? 'not-allowed' : 'pointer', padding: '10px 13px', borderRadius: '9px', background: 'transparent', color: selected.size === 0 ? FAINT : DIM, fontFamily: MONO, fontSize: '11px', opacity: downloading ? 0.6 : 1 }}
              >
                ⇪ ZIP
              </button>
            </div>

            <button
              onClick={() => handleRemoveTrack(focused.id)}
              style={{ width: '100%', marginTop: '10px', border: '1px solid rgba(255,80,80,0.2)', background: 'transparent', color: '#e87a7a', cursor: 'pointer', fontFamily: MONO, fontSize: '10.5px', letterSpacing: '1px', padding: '9px', borderRadius: '9px', textTransform: 'uppercase' }}
            >
              ✕ Remove from library
            </button>
          </div>
        )}
      </aside>

      {/* ===================== DOWNLOAD MODAL ===================== */}
      {downloadOpen && (
        <div
          onClick={() => setDownloadOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(4,4,5,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'ilm-rise .25s ease' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '560px', maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', background: '#0f0f12', border: `1px solid ${LINE}`, borderRadius: '18px', boxShadow: '0 30px 80px rgba(0,0,0,0.7)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', padding: '20px 24px', borderBottom: `1px solid ${LINE}` }}>
              <div>
                <div style={{ fontSize: '17px', fontWeight: 600 }}>New Download</div>
                <div style={{ fontFamily: MONO, fontSize: '10px', color: FAINT, letterSpacing: '1px', marginTop: '3px' }}>
                  PASTE A LINK · WE FETCH ART, METADATA &amp; BPM
                </div>
              </div>
              <button onClick={() => setDownloadOpen(false)} style={{ marginLeft: 'auto', border: 'none', background: 'rgba(255,255,255,0.05)', color: DIM, width: '30px', height: '30px', borderRadius: '8px', cursor: 'pointer', fontSize: '15px' }}>✕</button>
            </div>
            <div style={{ padding: '22px 24px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                {[['soundcloud', 'SoundCloud'], ['spotify', 'Spotify'], ['bandcamp', 'Bandcamp']].map(([src, label]) => {
                  const on = dlSource === src;
                  return (
                    <button
                      key={src}
                      onClick={() => setDlSource(src)}
                      style={{ flex: 1, border: `1px solid ${on ? ACCENT : LINE}`, background: on ? ACCENT_SOFT : 'rgba(255,255,255,0.02)', color: on ? '#f0d49a' : DIM, cursor: 'pointer', padding: '10px', borderRadius: '10px', fontFamily: 'inherit', fontSize: '13px', fontWeight: 500 }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  value={pastedUrl}
                  onChange={(e) => {
                    const url = e.target.value;
                    setPastedUrl(url);
                    const detected = detectSource(url);
                    if (detected) setDlSource(detected);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddSoundCloud(); }}
                  disabled={loadingTrack}
                  placeholder={
                    dlSource === 'soundcloud'
                      ? 'https://soundcloud.com/artist/track'
                      : dlSource === 'spotify'
                        ? 'https://open.spotify.com/track/…'
                        : 'https://artist.bandcamp.com/track/…'
                  }
                  style={{ ...fieldStyle, flex: 1, borderRadius: '10px', padding: '11px 13px' }}
                />
                <button
                  onClick={handleAddSoundCloud}
                  disabled={loadingTrack}
                  style={{ border: 'none', cursor: loadingTrack ? 'wait' : 'pointer', background: ACCENT, color: '#1a1407', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, padding: '0 18px', borderRadius: '10px', opacity: loadingTrack ? 0.6 : 1 }}
                >
                  {loadingTrack ? '…' : 'Fetch'}
                </button>
              </div>

              {(() => {
                const ut = detectUrlType(pastedUrl);
                if (!ut || (ut.type !== 'album' && ut.type !== 'playlist')) return null;
                return (
                  <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: ACCENT, background: ACCENT_SOFT, border: '1px solid rgba(230,178,76,0.3)', padding: '4px 10px', borderRadius: '20px' }}>
                      {ut.type === 'playlist' ? 'PLAYLIST' : 'ALBUM'}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: '10.5px', color: DIM }}>
                      {ut.source === 'spotify' ? 'Each track fetched via search — downloads as an album card' : 'Will download as an album card'}
                    </span>
                  </div>
                );
              })()}

              {loadingTrack && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '22px', color: DIM, fontFamily: MONO, fontSize: '12px' }}>
                  <span style={{ width: '16px', height: '16px', border: `2px solid ${LINE}`, borderTopColor: ACCENT, borderRadius: '50%', display: 'inline-block', animation: 'ilm-spin .7s linear infinite' }} />
                  Fetching track · detecting BPM…
                </div>
              )}

              <div style={{ marginTop: '22px' }}>
                <div style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '1.5px', color: FAINT, marginBottom: '10px' }}>
                  {downloading ? 'EXPORTING SELECTION' : `QUEUE · ${selected.size} SELECTED`}
                </div>
                {downloading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderTop: `1px solid ${LINE}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12.5px' }}>Building ZIP…</div>
                      <div style={{ height: '3px', borderRadius: '3px', background: 'rgba(255,255,255,0.07)', marginTop: '6px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: ACCENT, width: `${downloadProgress}%`, transition: 'width 0.3s ease-out' }} />
                      </div>
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: '10.5px', color: DIM, flex: 'none' }}>{downloadProgress}%</span>
                  </div>
                ) : (
                  <div style={{ fontFamily: MONO, fontSize: '11px', color: DIM, lineHeight: 1.6 }}>
                    Select records on the shelf, then export the whole queue as a ZIP from here or the inspector.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== SELECTION BAR (floating, above now-playing) ===================== */}
      {selected.size > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: '104px',
            left: 'calc((100vw - 338px) / 2)',
            transform: 'translateX(-50%)',
            zIndex: 40,
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            maxWidth: 'calc(100vw - 378px)',
            padding: '11px 18px',
            borderRadius: '16px',
            background: 'rgba(14,14,17,0.82)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.09)',
            boxShadow: '0 18px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.05em', textTransform: 'uppercase', color: DIM, whiteSpace: 'nowrap' }}>{selected.size} SELECTED</span>
          {downloading && (
            <div style={{ width: '120px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${downloadProgress}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), #caa055)', transition: 'width 0.3s ease-out' }} />
            </div>
          )}
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.5px', textTransform: 'uppercase', padding: '8px 20px', border: 'none', background: ACCENT, color: '#1a1407', cursor: downloading ? 'wait' : 'pointer', borderRadius: '9px', fontWeight: 600, opacity: downloading ? 0.6 : 1, whiteSpace: 'nowrap' }}
          >
            {downloading
              ? `DOWNLOADING… ${downloadProgress}%`
              : selected.size === 1
                ? 'DOWNLOAD TRACK'
                : `DOWNLOAD ${selected.size} AS ZIP`}
          </button>
        </div>
      )}

      {/* ===================== INNER ALBUM SHELF (overlay) ===================== */}
      {openAlbum && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'var(--bg)', display: 'flex', flexDirection: 'column', animation: 'ilm-rise .25s ease' }}>
          {/* Hidden audio elements for this album's tracks */}
          <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
            {(openAlbum.tracks || []).map(track => (
              <audio
                key={track.id}
                ref={el => { if (el) audioRefs.current[track.id] = el; }}
                src={track.url}
                preload="metadata"
                crossOrigin="anonymous"
              />
            ))}
          </div>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 26px', borderBottom: `1px solid ${LINE}`, background: 'rgba(8,8,10,0.6)' }}>
            <button
              onClick={() => {
                if (playingTrack && audioRefs.current[playingTrack]) audioRefs.current[playingTrack].pause();
                setPlayingTrack(null);
                setOpenAlbum(null);
              }}
              style={{ border: `1px solid ${LINE}`, background: 'transparent', color: INK, cursor: 'pointer', fontFamily: MONO, fontSize: '11px', letterSpacing: '0.5px', padding: '8px 14px', borderRadius: '9px' }}
            >
              ← Back
            </button>
            <AlbumArt track={openAlbum} size={40} radius={8} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '16px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{openAlbum.title}</div>
              <div style={{ fontSize: '12px', color: DIM, whiteSpace: 'nowrap' }}>
                {openAlbum.artist} · {(openAlbum.tracks ? openAlbum.tracks.length : 0)} tracks
              </div>
            </div>
            <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: '11px', letterSpacing: '0.5px', color: DIM }}>{sourceLabel(openAlbum.source)}</span>
            {openAlbum.tracks && openAlbum.tracks.length > 0 && (
              <button
                onClick={() => handleAlbumDownloadFull(openAlbum)}
                style={{ border: 'none', cursor: 'pointer', background: ACCENT, color: '#1a1407', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, padding: '9px 14px', borderRadius: '9px', flexShrink: 0 }}
              >
                ↓ Download Full Album
              </button>
            )}
          </div>

          {/* Card grid — auto-fill, minmax 190px */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '16px', alignContent: 'start' }}>
            {openAlbum.tracks && openAlbum.tracks.length ? (
              openAlbum.tracks.map((track, i) => {
                const isPlaying = playingTrack === track.id;
                const inQueue = isInQueue(track, track.sourceUrl);
                return (
                  <div
                    key={track.id ?? i}
                    onClick={() => handlePlay(track.id)}
                    style={{ background: '#111', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer', border: `1px solid ${isPlaying ? ACCENT : LINE}`, display: 'flex', flexDirection: 'column' }}
                  >
                    {/* Artwork — square, full width, top. flexShrink:0 so it can
                        never collapse the metadata section below it. */}
                    <div style={{ width: '100%', aspectRatio: '1', background: '#1a1a1a', flexShrink: 0 }}>
                      {track.artwork ? (
                        <img src={track.artwork} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', color: 'rgba(255,255,255,0.2)' }}>♪</div>
                      )}
                    </div>
                    {/* Metadata — title, artist, BPM/key/duration, + Queue */}
                    <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                      <span title={track.title} style={{ fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</span>
                      <span title={track.artist} style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</span>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px', fontFamily: MONO, fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                        <span>{track.bpm ? `${track.bpm} BPM` : '— BPM'}</span>
                        <span>{track.key || '—'}</span>
                        <span>{track.duration ? formatTime(track.duration) : '—'}</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); addToQueue(track, track.sourceUrl, { albumId: openAlbum.id, albumTitle: openAlbum.title }); }}
                        style={{ marginTop: '6px', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', letterSpacing: '0.03em', border: `1px solid ${inQueue ? ACCENT : 'rgba(255,255,255,0.12)'}`, background: 'transparent', color: inQueue ? ACCENT : 'rgba(255,255,255,0.5)', cursor: 'pointer', alignSelf: 'flex-start', fontFamily: 'inherit' }}
                      >
                        {inQueue ? '✓ In Queue' : '+ Queue'}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ gridColumn: '1 / -1', color: DIM, textAlign: 'center', padding: '48px', fontFamily: MONO, fontSize: '12px' }}>
                {albumProgress[openAlbum.id] && !albumProgress[openAlbum.id].done ? 'Downloading album tracks…' : 'No tracks in this album yet.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== QUEUE PANEL (right slide-in) =====================
          Always mounted; slides in/out via transform so queue state is never
          lost to conditional unmount. */}
      <div style={{ position: 'fixed', top: 0, right: 0, width: '360px', maxWidth: '90vw', height: '100vh', background: '#0d0d0d', borderLeft: `1px solid ${LINE}`, zIndex: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: queueOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.22s ease', pointerEvents: queueOpen ? 'auto' : 'none', boxShadow: queueOpen ? '-20px 0 50px rgba(0,0,0,0.5)' : 'none' }}>
          <div style={{ padding: '20px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontFamily: MONO, fontSize: '12px', letterSpacing: '1.6px', color: INK }}>QUEUE</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', color: DIM }}>
              {queue.filter(i => i.status === 'queued').length} queued · {queue.filter(i => i.status === 'done').length} downloaded
            </span>
            <button onClick={() => setQueueOpen(false)} style={{ marginLeft: 'auto', border: 'none', background: 'rgba(255,255,255,0.05)', color: DIM, width: '28px', height: '28px', borderRadius: '8px', cursor: 'pointer' }}>✕</button>
          </div>

          {queue.some(i => i.status === 'queued') && (
            <button
              onClick={handleQueueDownloadAll}
              style={{ margin: '12px 16px', padding: '12px', background: ACCENT, color: '#1a1407', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', letterSpacing: '0.05em' }}
            >
              ↓ Download All ({queue.filter(i => i.status === 'queued').length})
            </button>
          )}

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {queue.length === 0 && (
              <div style={{ padding: '40px 20px', color: DIM, fontSize: '12px', textAlign: 'center', fontFamily: MONO, lineHeight: 1.6 }}>
                Add tracks from the shelf or album view
              </div>
            )}
            {queue.map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: '8px', marginBottom: '4px', background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '6px', overflow: 'hidden', flexShrink: 0, background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.artwork
                    ? <img src={item.artwork} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '18px' }}>♪</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#fff' }}>{item.title}</span>
                  <span style={{ fontSize: '11px', color: DIM, fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.artist}{item.bpm ? ` · ${item.bpm} BPM` : ''}{item.key ? ` · ${item.key}` : ''}
                  </span>
                  {item.fromAlbum && (
                    <span style={{ fontSize: '10px', color: ACCENT, opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.fromAlbum.albumTitle}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  {item.status === 'queued' && (
                    <>
                      <button
                        onClick={() => handleQueueDownloadOne(item)}
                        disabled={!item.sourceUrl}
                        title={item.sourceUrl ? 'Download' : 'No source URL to download from'}
                        style={{ width: '26px', height: '26px', border: `1px solid ${LINE}`, borderRadius: '6px', background: 'transparent', color: INK, cursor: item.sourceUrl ? 'pointer' : 'not-allowed', opacity: item.sourceUrl ? 1 : 0.4 }}
                      >↓</button>
                      <button
                        onClick={() => removeFromQueue(item.id)}
                        style={{ width: '26px', height: '26px', border: `1px solid ${LINE}`, borderRadius: '6px', background: 'transparent', color: '#e87a7a', cursor: 'pointer' }}
                      >✕</button>
                    </>
                  )}
                  {item.status === 'downloading' && <span style={{ fontFamily: MONO, fontSize: '10px', padding: '3px 7px', borderRadius: '4px', letterSpacing: '0.05em', background: 'rgba(255,200,0,0.15)', color: '#ffc800' }}>DOWNLOADING</span>}
                  {item.status === 'done' && <span style={{ fontFamily: MONO, fontSize: '10px', padding: '3px 7px', borderRadius: '4px', letterSpacing: '0.05em', background: 'rgba(0,200,100,0.15)', color: '#00c864' }}>✓ DONE</span>}
                  {item.status === 'error' && <span style={{ fontFamily: MONO, fontSize: '10px', padding: '3px 7px', borderRadius: '4px', letterSpacing: '0.05em', background: 'rgba(255,60,60,0.15)', color: '#ff3c3c' }}>FAILED</span>}
                </div>
              </div>
            ))}
          </div>
      </div>
    </div>
  );
};

export default ILoveMusic;
