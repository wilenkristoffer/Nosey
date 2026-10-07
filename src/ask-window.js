const { BrowserWindow, screen } = require('electron')
const path = require('path')
const config = require('./config')

let askWin = null

// The main overlay is focusable: false, so a text input there can never
// receive keystrokes -- the ask box must be its own focusable window.
// `anchor` is the character's true {x, y} position, not the overlay window's
// current bounds -- the overlay window widens while a comment is showing, so
// its raw bounds don't always match where the character actually is.
function openAskWindow(anchor) {
  if (askWin && !askWin.isDestroyed()) {
    askWin.focus()
    return
  }

  const { width: w, height: h } = { width: config.ask.windowWidth, height: config.ask.windowHeight }
  const workArea = screen.getPrimaryDisplay().workArea
  let x = workArea.x + workArea.width - w - 20
  let y = workArea.y + workArea.height - h - 20
  if (anchor) {
    const { x: mx, y: my } = anchor
    x = Math.min(Math.max(workArea.x, mx - w - 12), workArea.x + workArea.width - w)
    y = Math.min(Math.max(workArea.y, my + 140), workArea.y + workArea.height - h)
  }

  askWin = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    backgroundColor: '#0d1117',
    title: 'Nosey Ask',
    webPreferences: {
      preload: path.join(__dirname, 'preload-ask.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  askWin.setAlwaysOnTop(true, 'screen-saver')
  askWin.loadFile(path.join(__dirname, 'renderer', 'ask', 'index.html'))
  askWin.on('blur', () => {
    if (askWin && !askWin.isDestroyed()) askWin.close()
  })
  askWin.on('closed', () => {
    askWin = null
  })
}

function closeAskWindow() {
  if (askWin && !askWin.isDestroyed()) askWin.close()
}

module.exports = { openAskWindow, closeAskWindow }
