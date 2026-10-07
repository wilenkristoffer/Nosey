const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('historyAPI', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getSessionComments: (sessionId) => ipcRenderer.invoke('get-session-comments', sessionId),
})
