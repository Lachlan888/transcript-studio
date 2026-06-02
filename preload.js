const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('transcriptStudio', {
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  installMissingTools: () => ipcRenderer.invoke('install-missing-tools'),
  chooseFile: () => ipcRenderer.invoke('choose-file'),
  chooseFiles: () => ipcRenderer.invoke('choose-files'),
  chooseOutputFolder: () => ipcRenderer.invoke('choose-output-folder'),
  resetOutputFolder: () => ipcRenderer.invoke('reset-output-folder'),
  setCleanupIntermediateMedia: (enabled) => ipcRenderer.invoke('set-cleanup-intermediate-media', enabled),
  cleanupIntermediateMedia: (outputDir) => ipcRenderer.invoke('cleanup-intermediate-media', outputDir),
  hasIntermediateMedia: (outputDir) => ipcRenderer.invoke('has-intermediate-media', outputDir),
  startTranscript: (options) => ipcRenderer.invoke('start-transcript', options),
  stopCurrentJob: () => ipcRenderer.invoke('stop-current-job'),
  openOutputFolder: (outputDir) => ipcRenderer.invoke('open-output-folder', outputDir),
  saveTranscript: (payload) => ipcRenderer.invoke('save-transcript', payload),
  copyTranscript: (text) => ipcRenderer.invoke('copy-transcript', text),
  copyManualInstallCommands: () => ipcRenderer.invoke('copy-manual-commands'),
  copyLog: (text) => ipcRenderer.invoke('copy-log', text),
  onLog: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('transcript-log', listener);
    return () => ipcRenderer.removeListener('transcript-log', listener);
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('transcript-status', listener);
    return () => ipcRenderer.removeListener('transcript-status', listener);
  },
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('transcript-progress', listener);
    return () => ipcRenderer.removeListener('transcript-progress', listener);
  }
});
