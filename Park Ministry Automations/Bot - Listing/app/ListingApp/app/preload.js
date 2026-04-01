const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('listingApp', {
  runListing: (payload) => ipcRenderer.invoke('listing:run', payload),
  getLicenseStatus: () => ipcRenderer.invoke('listing:getLicenseStatus'),
  getSettings: () => ipcRenderer.invoke('listing:getSettings'),
  saveSettings: (payload) => ipcRenderer.invoke('listing:saveSettings', payload),
  openOutputs: () => ipcRenderer.invoke('listing:openOutputs'),
  openCsv: () => ipcRenderer.invoke('listing:openCsv'),
  onRunLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('listing:run-log', listener);
    return () => ipcRenderer.removeListener('listing:run-log', listener);
  },
});
