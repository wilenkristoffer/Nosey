const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouse: (v) => ipcRenderer.send('set-ignore-mouse', v),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  getPosition: () => ipcRenderer.invoke('get-position'),
  setPosition: (x, y) => ipcRenderer.send('set-position', x, y),
  setBubbleVisible: (visible) => ipcRenderer.send('set-bubble-visible', visible),
  onBubbleAnchor: (cb) => ipcRenderer.on('bubble-anchor', (_, expandRight) => cb(expandRight)),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  startOllamaStream: (img) => ipcRenderer.invoke('ollama-stream-start', { base64Image: img }),
  onOllamaToken: (cb) => ipcRenderer.on('ollama-token', (_, t) => cb(t)),
  onOllamaDone: (cb) => ipcRenderer.on('ollama-done', () => cb()),
  removeOllamaListeners: () => {
    ipcRenderer.removeAllListeners('ollama-token')
    ipcRenderer.removeAllListeners('ollama-done')
  },
  onScreenChanged: (cb) => ipcRenderer.on('screen-changed', (_, b64) => cb(b64)),
  onTriggerPeek: (cb) => ipcRenderer.on('trigger-peek', () => cb()),
  onStartupError: (cb) => ipcRenderer.on('startup-error', (_, msg) => cb(msg)),
  onCommentSaved: (cb) => ipcRenderer.on('comment-saved', (_, data) => cb(data)),
  updateFunnyRating: (id, funny) => ipcRenderer.send('update-funny-rating', id, funny),
  getConfig: () => ipcRenderer.invoke('get-config'),
  onAskCountdown: (cb) => ipcRenderer.on('ask-countdown', (_, n) => cb(n)),
  onAskStart: (cb) => ipcRenderer.on('ask-start', () => cb()),
})
