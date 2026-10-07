const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('settingsAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  applySettings: (patch) => ipcRenderer.send('apply-settings', patch),
  getPersonas: () => ipcRenderer.invoke('get-personas'),
  getModes: () => ipcRenderer.invoke('get-modes'),
  getHardware: () => ipcRenderer.invoke('get-hardware'),
})
