const { BrowserWindow } = require('electron')
const path = require('path')

let settingsWin = null

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 540,
    height: 700,
    backgroundColor: '#0d1117',
    resizable: false,
    title: 'Nosey Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings', 'index.html'))
  settingsWin.on('closed', () => {
    settingsWin = null
  })
}

module.exports = { openSettingsWindow }
