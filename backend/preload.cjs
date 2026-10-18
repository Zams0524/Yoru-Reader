const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startGoogleOauth: (clientId) => ipcRenderer.invoke('start-google-oauth', clientId),
  speakText: (params) => ipcRenderer.invoke('speak-text', params),
  ankiRequest: (host, body) => ipcRenderer.invoke('anki-request', { host, body }),
  downloadGoogleDrive: (urlString, id) => ipcRenderer.invoke('download-google-drive', { urlString, id }),
  readLocalFile: (filePath) => ipcRenderer.invoke('read-local-file', filePath),
  onDownloadProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('download-progress-event', listener);
    return () => ipcRenderer.off('download-progress-event', listener);
  },
  getReaderExtId: () => ipcRenderer.invoke('get-reader-extension-id'),
  openReaderExtSettings: (theme) => ipcRenderer.invoke('open-reader-extension-settings', theme),
  onQueryWordStatuses: (callback) => {
    const listener = (event, words) => callback(words);
    ipcRenderer.on('query-word-statuses', listener);
    return () => ipcRenderer.off('query-word-statuses', listener);
  },
  replyQueryWordStatuses: (result) => ipcRenderer.send('reply-query-word-statuses', result),
  onSaveWordToSrs: (callback) => {
    const listener = (event, wordData) => callback(wordData);
    ipcRenderer.on('save-word-to-srs', listener);
    return () => ipcRenderer.off('save-word-to-srs', listener);
  },
  replySaveWordToSrs: () => ipcRenderer.send('reply-save-word-to-srs'),
  onUpdateWordStatus: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('update-word-status', listener);
    return () => ipcRenderer.off('update-word-status', listener);
  },
  replyUpdateWordStatus: () => ipcRenderer.send('reply-update-word-status'),
  onParseTextRequest: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('parse-text-request', listener);
    return () => ipcRenderer.off('parse-text-request', listener);
  },
  replyParseText: (result) => ipcRenderer.send('reply-parse-text', result),
  updateDiscordPresence: (presence) => ipcRenderer.invoke('update-discord-presence', presence),
  downloadAndInstallUpdate: (urlString) => ipcRenderer.invoke('download-and-install-update', { urlString }),
  onUpdateDownloadProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('update-download-progress', listener);
    return () => ipcRenderer.off('update-download-progress', listener);
  },
  checkHotUpdate: () => ipcRenderer.invoke('check-hot-update'),
  downloadHotUpdate: (params) => ipcRenderer.invoke('download-hot-update', params),
  applyHotUpdateAndRelaunch: () => ipcRenderer.invoke('apply-hot-update-and-relaunch'),
  onOtaDownloadProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('ota-download-progress', listener);
    return () => ipcRenderer.off('ota-download-progress', listener);
  },
  clearOtaCache: () => ipcRenderer.invoke('clear-ota-cache'),
  reloadApp: () => ipcRenderer.invoke('reload-app')
});
