// Exposes the few desktop-only actions to the web UI as window.CineMoyDesktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('CineMoyDesktop', {
  info: () => ipcRenderer.invoke('cm:info'),
  setLanSharing: on => ipcRenderer.invoke('cm:setLanSharing', !!on),
});
