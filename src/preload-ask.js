const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('askAPI', {
  askNosey: (question) => ipcRenderer.send('ask-nosey', question),
  closeAsk: () => ipcRenderer.send('close-ask'),
})
