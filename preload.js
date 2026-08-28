const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  addSoundCloud: (url) => ipcRenderer.invoke('soundcloud:add', url),
  downloadTracks: (trackIds, tracks) => ipcRenderer.invoke('soundcloud:download', trackIds, tracks),
  exportRekordbox: (tracks) => ipcRenderer.invoke('exportRekordbox', tracks),
  saveTracks: (tracks) => ipcRenderer.invoke('tracks:save', tracks),
  loadTracks: () => ipcRenderer.invoke('tracks:load'),
  // Albums / playlists (Phase 1: SoundCloud + Bandcamp)
  downloadScBandcampAlbum: (payload) => ipcRenderer.invoke('download-sc-bandcamp-album', payload),
  downloadSpotifyAlbum: (url) => ipcRenderer.invoke('download-spotify-album', url),
  saveAlbums: (albums) => ipcRenderer.invoke('albums:save', albums),
  loadAlbums: () => ipcRenderer.invoke('albums:load'),
  saveQueue: (queue) => ipcRenderer.invoke('queue:save', queue),
  loadQueue: () => ipcRenderer.invoke('queue:load'),
  showInFinder: (filePath) => ipcRenderer.invoke('show-in-finder', filePath),
  onAlbumMetaReady: (cb) => ipcRenderer.on('album-meta-ready', (_, data) => cb(data)),
  onAlbumDownloadProgress: (cb) => ipcRenderer.on('album-download-progress', (_, data) => cb(data)),
  onAlbumTracksReady: (cb) => ipcRenderer.on('album-tracks-ready', (_, data) => cb(data)),
  enrichTrackMetadata: (filePath) =>
    ipcRenderer.invoke('enrich-track-metadata', filePath),
  extractArtwork: (filePath) =>
    ipcRenderer.invoke('extract-artwork', filePath),
  detectBpmKey: (payload) => ipcRenderer.invoke('detect-bpm-key', payload),
  triggerHaptic: (type) => ipcRenderer.invoke('trigger-haptic', type),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download:progress', (_, progress) => callback(progress));
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download:progress');
  }
});
