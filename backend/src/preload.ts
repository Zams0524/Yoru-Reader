import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  startGoogleOauth: (clientId: string) => Promise<any>;
  cancelGoogleOauth: () => Promise<void>;
  speakText: (params: { text: string; voice: string; rate?: number }) => Promise<Buffer>;
  ankiRequest: (host: string, body: any) => Promise<any>;
  downloadGoogleDrive: (urlString: string, id: string) => Promise<any>;
  readLocalFile: (filePath: string) => Promise<any>;
  onDownloadProgress: (callback: (data: any) => void) => () => void;
  getReaderExtId: () => Promise<string>;
  openReaderExtSettings: (theme: string) => Promise<boolean>;
  onQueryWordStatuses: (callback: (words: string[]) => void) => () => void;
  replyQueryWordStatuses: (result: Record<string, string>) => void;
  onSaveWordToSrs: (callback: (wordData: any) => void) => () => void;
  replySaveWordToSrs: () => void;
  onUpdateWordStatus: (callback: (data: any) => void) => () => void;
  replyUpdateWordStatus: () => void;
  onParseTextRequest: (callback: (data: { requestId: string; paragraphs: string[] }) => void) => () => void;
  replyParseText: (result: any) => void;
  updateDiscordPresence: (presence: any) => Promise<any>;
  updater: {
    getState: () => Promise<any>;
    check: (options?: { autoDownload?: boolean }) => Promise<any>;
    download: () => Promise<any>;
    install: () => Promise<any>;
    setAutoInstallOnQuit: (value: boolean) => Promise<boolean>;
    openFallback: () => Promise<void>;
    onState: (callback: (state: any) => void) => () => void;
  };
  clearOtaCache: () => Promise<boolean>;
  reloadApp: () => Promise<void>;
}

const electronAPI: ElectronAPI = {
  startGoogleOauth: (clientId: string) => ipcRenderer.invoke('start-google-oauth', clientId),
  cancelGoogleOauth: () => ipcRenderer.invoke('cancel-google-oauth'),
  speakText: (params: { text: string; voice: string; rate?: number }) => ipcRenderer.invoke('speak-text', params),
  ankiRequest: (host: string, body: any) => ipcRenderer.invoke('anki-request', { host, body }),
  downloadGoogleDrive: (urlString: string, id: string) => ipcRenderer.invoke('download-google-drive', { urlString, id }),
  readLocalFile: (filePath: string) => ipcRenderer.invoke('read-local-file', filePath),
  onDownloadProgress: (callback: (data: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('download-progress-event', listener);
    return () => ipcRenderer.off('download-progress-event', listener);
  },
  getReaderExtId: () => ipcRenderer.invoke('get-reader-extension-id'),
  openReaderExtSettings: (theme: string) => ipcRenderer.invoke('open-reader-extension-settings', theme),
  onQueryWordStatuses: (callback: (words: string[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, words: string[]) => callback(words);
    ipcRenderer.on('query-word-statuses', listener);
    return () => ipcRenderer.off('query-word-statuses', listener);
  },
  replyQueryWordStatuses: (result: Record<string, string>) => ipcRenderer.send('reply-query-word-statuses', result),
  onSaveWordToSrs: (callback: (wordData: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, wordData: any) => callback(wordData);
    ipcRenderer.on('save-word-to-srs', listener);
    return () => ipcRenderer.off('save-word-to-srs', listener);
  },
  replySaveWordToSrs: () => ipcRenderer.send('reply-save-word-to-srs'),
  onUpdateWordStatus: (callback: (data: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('update-word-status', listener);
    return () => ipcRenderer.off('update-word-status', listener);
  },
  replyUpdateWordStatus: () => ipcRenderer.send('reply-update-word-status'),
  onParseTextRequest: (callback: (data: { requestId: string; paragraphs: string[] }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { requestId: string; paragraphs: string[] }) => callback(data);
    ipcRenderer.on('parse-text-request', listener);
    return () => ipcRenderer.off('parse-text-request', listener);
  },
  replyParseText: (result: any) => ipcRenderer.send('reply-parse-text', result),
  updateDiscordPresence: (presence: any) => ipcRenderer.invoke('update-discord-presence', presence),
  updater: {
    getState: () => ipcRenderer.invoke('updater:get-state'),
    check: (options?: { autoDownload?: boolean }) => ipcRenderer.invoke('updater:check', options),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    setAutoInstallOnQuit: (value: boolean) => ipcRenderer.invoke('updater:set-auto-install', value),
    openFallback: () => ipcRenderer.invoke('updater:open-fallback'),
    onState: (callback: (state: any) => void) => {
      const listener = (_event: any, state: any) => callback(state);
      ipcRenderer.on('updater-state', listener);
      return () => ipcRenderer.off('updater-state', listener);
    }
  },
  clearOtaCache: () => ipcRenderer.invoke('clear-ota-cache'),
  reloadApp: () => ipcRenderer.invoke('reload-app')
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
