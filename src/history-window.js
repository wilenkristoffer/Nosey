const { BrowserWindow } = require('electron')
const path = require('path')

let historyWin = null

function openHistoryWindow() {
  if (historyWin && !historyWin.isDestroyed()) {
    historyWin.focus()
    return
  }

  historyWin = new BrowserWindow({
    width: 900,
    height: 620,
    backgroundColor: '#0d1117',
    title: 'Nosey — Session History',
    webPreferences: {
      preload: path.join(__dirname, 'preload-history.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  historyWin.loadFile(path.join(__dirname, 'renderer', 'history', 'index.html'))
  historyWin.on('closed', () => {
    historyWin = null
  })
}

module.exports = { openHistoryWindow }
