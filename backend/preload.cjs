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
  updater: {
    getState: () => ipcRenderer.invoke('updater:get-state'),
    check: (options) => ipcRenderer.invoke('updater:check', options),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    setAutoInstallOnQuit: (value) => ipcRenderer.invoke('updater:set-auto-install', value),
    openFallback: () => ipcRenderer.invoke('updater:open-fallback'),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('updater-state', listener);
      return () => ipcRenderer.off('updater-state', listener);
    }
  },
  clearOtaCache: () => ipcRenderer.invoke('clear-ota-cache'),
  reloadApp: () => ipcRenderer.invoke('reload-app')
});
