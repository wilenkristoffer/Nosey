const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  desktopCapturer,
  Menu,
  globalShortcut,
} = require('electron')
const path = require('path')
const fs = require('fs')
const config = require('./config')
const { samplePixels, diffRatio } = require('./capture-utils')
const {
  fetchDescription,
  fetchAskDescription,
  streamDirectComment,
  streamComment,
  streamAnswer,
  streamDirectAnswer,
  streamRecap,
  getPersonas,
  getModes,
} = require('./ollama-client')
const { setupTelemetry } = require('./telemetry')
const hardware = require('./hardware')
const {
  initDb,
  openSession,
  closeSession,
  saveComment,
  updateFunnyRating,
  getSessions,
  getSessionComments,
  getTodaysComments,
} = require('./db')
const { buildMemoryContext, embedAndStore, updateSessionSummary } = require('./rag')
const { openHistoryWindow } = require('./history-window')
const { openSettingsWindow } = require('./settings-window')
const { openAskWindow, closeAskWindow } = require('./ask-window')

const tracer = setupTelemetry()

if (require('electron-squirrel-startup')) app.quit()

const DEBUG_MODE = config.debug

// Debug captures hold real screen content, so they go to the per-user app data
// folder (%APPDATA%\Nosey\debug), never into the source tree or the package
function debugSave(ts, label, content) {
  const dir = path.join(app.getPath('userData'), 'debug')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${ts}_${label}`), content)
}

// Names of the installed Ollama models, or null when Ollama is not reachable
async function installedModels() {
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`)
    if (!res.ok) return null
    const data = await res.json()
    return (data.models || []).map((m) => m.name)
  } catch {
    return null
  }
}

function missingModels(installed) {
  const has = (name) => installed.includes(name) || installed.includes(`${name}:latest`)
  return [...new Set([config.models.vision, config.models.text])].filter((m) => !has(m))
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------
let settingsFilePath = null

const defaultAppSettings = {
  profile: config.device.profile,
  interval: config.capture.intervalMs,
  active: true,
  persona: config.defaultPersona,
  mode: config.defaultMode,
  askCapture: config.ask.defaultCapture,
}

let appSettings = { ...defaultAppSettings }

function loadAppSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'))
    appSettings = { ...defaultAppSettings, ...saved }
  } catch {
    // file not found or corrupt — use defaults
  }
}

function saveAppSettings() {
  try {
    fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2))
  } catch (err) {
    console.warn('[settings] save failed:', err.message)
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
let sessionId = null
let commentCount = 0
let askInProgress = false

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Capture loop (uses mainWin instead of event.sender)
// ---------------------------------------------------------------------------
let mainWin = null
let lastPixels = null
let lastActiveWindow = ''
let captureTimer = null
let visionModel = config.models.vision
let textModel = config.models.text
let currentPersona = config.defaultPersona

// Switches models and context size to a device profile ('auto', 'desktop',
// 'laptop', 'small', 'cpu' or 'custom' -- see src/hardware.js)
function useProfile(name) {
  const active = hardware.applyProfile(config, name)
  visionModel = config.models.vision
  textModel = config.models.text
  console.log(
    `[device] ${hardware.describe(hardware.detect())} -> profile ${active}, model ${visionModel}` +
      (textModel !== visionModel ? ` + ${textModel}` : '')
  )
  return active
}
let currentMode = config.defaultMode

async function getActiveWindowName() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    // All Nosey windows (overlay, ask, settings, history) are titled with a
    // 'Nosey' prefix so none of them ever counts as the user's active window
    const win = sources.find(
      (s) => s.name && s.name.trim().length > 0 && !s.name.startsWith('Nosey')
    )
    return win ? win.name : ''
  } catch {
    return ''
  }
}

async function captureWindow(windowName) {
  if (!windowName) return null
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: config.capture.thumbnailWidth, height: config.capture.thumbnailHeight },
  })
  const source = sources.find((s) => s.name === windowName)
  if (!source?.thumbnail) return null
  const pixels = samplePixels(source.thumbnail.toBitmap())
  const ratio = diffRatio(lastPixels, pixels)
  lastPixels = pixels
  if (ratio < config.capture.minChangeRatio) return null
  return source.thumbnail.toJPEG(config.capture.jpegQuality).toString('base64')
}

async function captureNamedWindowImage(windowName) {
  if (!windowName) return null
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: config.capture.thumbnailWidth, height: config.capture.thumbnailHeight },
  })
  const source = sources.find((s) => s.name === windowName)
  if (!source?.thumbnail) return null
  return source.thumbnail.toJPEG(config.capture.jpegQuality).toString('base64')
}

async function captureFullScreen() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: config.capture.thumbnailWidth, height: config.capture.thumbnailHeight },
  })
  const source = sources[0]
  if (!source?.thumbnail) return null
  return source.thumbnail.toJPEG(config.capture.jpegQuality).toString('base64')
}

function startCapture(intervalMs) {
  if (captureTimer) clearInterval(captureTimer)
  captureTimer = setInterval(async () => {
    if (!mainWin || mainWin.isDestroyed()) return
    if (askInProgress) return
    const tickSpan = tracer.startSpan('nosey.capture_tick')
    try {
      const activeWindow = await getActiveWindowName()
      tickSpan.setAttribute('window.name', activeWindow)
      const changed = Boolean(activeWindow) && activeWindow !== lastActiveWindow
      tickSpan.setAttribute('window.changed', changed)
      if (!changed) return
      lastActiveWindow = activeWindow
      const base64 = await captureWindow(activeWindow)
      tickSpan.setAttribute('image.captured', base64 !== null)
      if (base64) mainWin.webContents.send('screen-changed', base64)
    } finally {
      tickSpan.end()
    }
  }, intervalMs)
}

function stopCapture() {
  if (captureTimer) {
    clearInterval(captureTimer)
    captureTimer = null
  }
}

// Pauses/resumes the ambient window-switch commentary. Ask Nosey is gated by
// its own askInProgress flag and never goes through startCapture/stopCapture,
// so it keeps working while paused.
function setActive(active) {
  appSettings.active = active
  saveAppSettings()
  if (active) {
    startCapture(appSettings.interval)
  } else {
    stopCapture()
  }
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------
// The window is normally exactly as wide as the character. While a comment
// bubble is visible it grows to bubbleWidthMultiplier x that width, toward
// whichever side of the screen has room -- charX/charY track the character's
// true anchor point so the character itself never visibly moves when the
// window widens or shrinks back.
let charX = 0
let charY = 0
let bubbleExpanded = false

function computeCompactBounds() {
  return { x: charX, y: charY, width: config.window.width, height: config.window.height }
}

function computeExpandedBounds() {
  const bubbleWidth = config.window.width * config.window.bubbleWidthMultiplier
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
  const expandRight = charX + bubbleWidth <= screenWidth
  const x = expandRight ? charX : Math.max(0, charX - (bubbleWidth - config.window.width))
  return { x, y: charY, width: bubbleWidth, height: config.window.height, expandRight }
}

function applyBounds() {
  if (!mainWin || mainWin.isDestroyed()) return
  if (!bubbleExpanded) {
    mainWin.setBounds(computeCompactBounds())
    return
  }
  const { expandRight, ...bounds } = computeExpandedBounds()
  mainWin.setBounds(bounds)
  mainWin.webContents.send('bubble-anchor', expandRight)
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  charX = width - config.window.edgeOffsetX
  charY = height - config.window.edgeOffsetY

  mainWin = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    x: charX,
    y: charY,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWin.setAlwaysOnTop(true, 'screen-saver')
  mainWin.setVisibleOnAllWorkspaces(true)
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  setInterval(() => {
    if (!mainWin.isDestroyed()) mainWin.setAlwaysOnTop(true, 'screen-saver')
  }, config.window.alwaysOnTopIntervalMs)

  mainWin.webContents.on('did-finish-load', async () => {
    mainWin.show()
    await initDb()
    sessionId = await openSession()
    const installed = await installedModels()
    const missing = installed ? missingModels(installed) : []
    if (!installed) {
      mainWin.webContents.send(
        'startup-error',
        'Ollama is not running. Start it with: ollama serve'
      )
    } else if (missing.length > 0) {
      mainWin.webContents.send(
        'startup-error',
        `Model not installed. Run: ${missing.map((m) => `ollama pull ${m}`).join(' and ')}`
      )
    } else {
      mainWin.webContents.send('trigger-peek')
    }
    if (appSettings.active) startCapture(appSettings.interval)
  })

  mainWin.setIgnoreMouseEvents(true, { forward: true })

  ipcMain.on('set-ignore-mouse', (_, ignore) => {
    mainWin.setIgnoreMouseEvents(ignore, { forward: true })
  })

  let dragInterval = null

  ipcMain.on('drag-start', () => {
    if (dragInterval) clearInterval(dragInterval)
    let last = screen.getCursorScreenPoint()
    dragInterval = setInterval(() => {
      const cur = screen.getCursorScreenPoint()
      const dx = cur.x - last.x
      const dy = cur.y - last.y
      if (dx !== 0 || dy !== 0) {
        charX += dx
        charY += dy
        applyBounds()
        last = cur
      }
    }, 16)
  })

  ipcMain.on('drag-end', () => {
    if (dragInterval) {
      clearInterval(dragInterval)
      dragInterval = null
    }
  })

  ipcMain.handle('get-position', () => [charX, charY])

  ipcMain.on('set-position', (_, x, y) => {
    charX = Math.round(x)
    charY = Math.round(y)
    applyBounds()
  })

  ipcMain.on('set-bubble-visible', (_, visible) => {
    bubbleExpanded = visible
    applyBounds()
  })
}

// ---------------------------------------------------------------------------
// Ollama pipeline
// ---------------------------------------------------------------------------
ipcMain.handle('ollama-stream-start', async (event, { base64Image }) => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const mem = process.memoryUsage()
  const mode = config.mode === 'single' || visionModel === textModel ? 'single' : 'two-model'
  const pipelineSpan = tracer.startSpan('nosey.ollama_pipeline', {
    attributes: {
      'model.mode': mode,
      'model.vision': visionModel,
      'model.text': textModel,
      'process.memory_rss_mb': Math.round(mem.rss / 1024 / 1024),
      'process.memory_heap_mb': Math.round(mem.heapUsed / 1024 / 1024),
    },
  })
  const startTime = Date.now()
  try {
    if (DEBUG_MODE) {
      debugSave(ts, 'screen.jpg', Buffer.from(base64Image, 'base64'))
    }

    const memCtx = await buildMemoryContext(sessionId, lastActiveWindow, null, currentPersona)
    if (memCtx && DEBUG_MODE) console.log('[rag] context injected:\n' + memCtx)

    let comment = ''
    let description = null

    if (visionModel === textModel) {
      const streamSpan = tracer.startSpan('nosey.stream_comment')
      let tokenCount = 0
      try {
        for await (const token of streamDirectComment(
          base64Image,
          visionModel,
          memCtx,
          currentPersona,
          currentMode
        )) {
          if (askInProgress) break
          event.sender.send('ollama-token', token)
          comment += token
          tokenCount++
        }
      } finally {
        streamSpan.setAttribute('token_count', tokenCount)
        streamSpan.setAttribute('model', visionModel)
        streamSpan.end()
      }
    } else {
      const visionSpan = tracer.startSpan('nosey.vision_describe')
      try {
        description = await fetchDescription(base64Image, visionModel)
        if (DEBUG_MODE) console.log('[vision]', description)
        if (DEBUG_MODE) debugSave(ts, 'description.txt', description)
      } finally {
        visionSpan.setAttribute('description.length', description ? description.length : 0)
        visionSpan.setAttribute('model', visionModel)
        visionSpan.end()
      }

      if (!description || description.trim().length < 20) {
        if (!askInProgress) event.sender.send('ollama-done')
        return
      }

      const memCtxWithDesc = await buildMemoryContext(
        sessionId,
        lastActiveWindow,
        description,
        currentPersona
      )

      const streamSpan = tracer.startSpan('nosey.stream_comment')
      let tokenCount = 0
      try {
        for await (const token of streamComment(
          description,
          textModel,
          memCtxWithDesc,
          currentPersona,
          currentMode
        )) {
          if (askInProgress) break
          event.sender.send('ollama-token', token)
          comment += token
          tokenCount++
        }
      } finally {
        streamSpan.setAttribute('token_count', tokenCount)
        streamSpan.setAttribute('model', textModel)
        streamSpan.end()
      }
    }

    if (DEBUG_MODE) {
      debugSave(ts, 'comment.txt', comment)
    }

    pipelineSpan.setAttribute('comment.length', comment.length)
    pipelineSpan.setAttribute('comment.text', comment)

    const durationMs = Date.now() - startTime
    const tokenCount = comment.split(/\s+/).length

    if (comment.trim().length > 0) {
      const commentId = await saveComment(sessionId, {
        windowName: lastActiveWindow,
        description,
        comment,
        modelVision: visionModel,
        modelText: textModel,
        mode,
        persona: currentPersona,
        durationMs,
        tokenCount,
      })

      if (commentId) {
        pipelineSpan.setAttribute('comment.id', commentId)
        event.sender.send('comment-saved', { commentId })
        embedAndStore(commentId, comment)
        commentCount++
        if (commentCount % config.rag.summaryEveryN === 0) {
          updateSessionSummary(sessionId, textModel, commentCount)
        }
      }
    }

    // When an ask preempted this comment, the ask flow owns the bubble now --
    // a done event here would cut the answer off mid-stream
    if (!askInProgress) event.sender.send('ollama-done')
  } catch (err) {
    pipelineSpan.recordException(err)
    if (!askInProgress) {
      event.sender.send('ollama-token', `[${err.message}]`)
      event.sender.send('ollama-done')
    }
  } finally {
    pipelineSpan.end()
  }
})

// ---------------------------------------------------------------------------
// Ask Nosey (works in every mode -- persona colors the voice, mode is ignored)
// ---------------------------------------------------------------------------
ipcMain.on('close-ask', () => closeAskWindow())

ipcMain.on('ask-nosey', async (_, question) => {
  if (!mainWin || mainWin.isDestroyed() || askInProgress) return
  if (!question || !question.trim()) return
  askInProgress = true
  const send = (channel, ...args) => {
    if (!mainWin.isDestroyed()) mainWin.webContents.send(channel, ...args)
  }
  const askSpan = tracer.startSpan('nosey.ask', {
    attributes: { 'ask.capture': appSettings.askCapture },
  })
  const startTime = Date.now()
  try {
    closeAskWindow()

    let base64 = null
    let windowName = 'fullscreen'
    if (appSettings.askCapture === 'window') {
      for (let n = config.ask.countdownSeconds; n > 0; n--) {
        send('ask-countdown', n)
        await sleep(1000)
      }
      windowName = await getActiveWindowName()
      base64 = await captureNamedWindowImage(windowName)
    } else {
      base64 = await captureFullScreen()
    }

    send('ask-start')
    if (!base64) {
      send('ollama-token', 'I could not get a look at the screen. Try again?')
      send('ollama-done')
      return
    }

    let answer = ''
    let description = null
    if (visionModel === textModel) {
      for await (const token of streamDirectAnswer(base64, question, visionModel)) {
        send('ollama-token', token)
        answer += token
      }
    } else {
      description = await fetchAskDescription(base64, question, visionModel)
      if (DEBUG_MODE) console.log('[ask-vision]', description)
      for await (const token of streamAnswer(description, question, textModel)) {
        send('ollama-token', token)
        answer += token
      }
    }

    askSpan.setAttribute('answer.length', answer.length)

    if (answer.trim().length > 0) {
      await saveComment(sessionId, {
        windowName,
        description,
        comment: answer,
        modelVision: visionModel,
        modelText: textModel,
        mode: visionModel === textModel ? 'single' : 'two-model',
        persona: currentPersona,
        durationMs: Date.now() - startTime,
        tokenCount: answer.split(/\s+/).length,
        kind: 'answer',
        question,
      })
    }

    send('ollama-done')
  } catch (err) {
    askSpan.recordException(err)
    send('ollama-token', `[${err.message}]`)
    send('ollama-done')
  } finally {
    askInProgress = false
    askSpan.end()
  }
})

// ---------------------------------------------------------------------------
// Daily recap
// ---------------------------------------------------------------------------
async function handleDailyRecap() {
  if (!mainWin || mainWin.isDestroyed() || askInProgress) return
  askInProgress = true
  const send = (channel, ...args) => {
    if (!mainWin.isDestroyed()) mainWin.webContents.send(channel, ...args)
  }
  const recapSpan = tracer.startSpan('nosey.daily_recap')
  try {
    send('ask-start')
    const rows = await getTodaysComments()
    recapSpan.setAttribute('recap.comment_count', rows.length)
    if (rows.length === 0) {
      send(
        'ollama-token',
        'I have seen nothing today. Either you just started, or you are suspiciously good at hiding.'
      )
      send('ollama-done')
      return
    }
    const lines = rows.map((r) => `- [${r.window_name || 'unknown'}] ${r.comment}`)
    for await (const token of streamRecap(lines, textModel, currentPersona)) {
      send('ollama-token', token)
    }
    send('ollama-done')
  } catch (err) {
    recapSpan.recordException(err)
    send('ollama-token', `[${err.message}]`)
    send('ollama-done')
  } finally {
    askInProgress = false
    recapSpan.end()
  }
}

// ---------------------------------------------------------------------------
// Settings IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-settings', () => appSettings)

ipcMain.on('apply-settings', (_, patch) => {
  Object.assign(appSettings, patch)
  saveAppSettings()

  if (patch.profile !== undefined) useProfile(patch.profile)
  if (patch.persona !== undefined) currentPersona = patch.persona
  if (patch.mode !== undefined) currentMode = patch.mode

  if (patch.active !== undefined || patch.interval !== undefined) {
    if (appSettings.active) {
      startCapture(appSettings.interval)
    } else {
      stopCapture()
    }
  }
})

// ---------------------------------------------------------------------------
// Other IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-personas', () => getPersonas())
ipcMain.handle('get-modes', () => getModes())
ipcMain.handle('get-sessions', () => getSessions())
ipcMain.handle('get-session-comments', (_, sid) => getSessionComments(sid))
ipcMain.handle('get-config', () => config.ui)

ipcMain.handle('get-hardware', async () => {
  const info = hardware.detect()
  const installed = (await installedModels()) || []
  return {
    summary: hardware.describe(info),
    suggested: info.profile,
    active: config.device.active,
    model: visionModel === textModel ? visionModel : `${visionModel} + ${textModel}`,
    missing: installed.length ? missingModels(installed) : [],
    profiles: hardware.PROFILE_NAMES.map((id) => ({
      id,
      label:
        id === 'auto'
          ? `Automatic (${hardware.PROFILES[info.profile].label})`
          : id === 'custom'
            ? 'Custom (models in config.js)'
            : hardware.PROFILES[id].label,
      model: hardware.PROFILES[id] ? hardware.PROFILES[id].models.vision : null,
    })),
  }
})

ipcMain.on('update-funny-rating', (_, commentId, funny) => {
  updateFunnyRating(commentId, funny)
})

ipcMain.on('show-context-menu', (event) => {
  const menu = Menu.buildFromTemplate([
    { label: 'Ask Nosey', click: () => openAskWindow({ x: charX, y: charY }) },
    {
      label: appSettings.active ? 'Pause Nosey' : 'Resume Nosey',
      click: () => setActive(!appSettings.active),
    },
    { label: 'Daily Recap', click: () => handleDailyRecap() },
    { type: 'separator' },
    { label: 'Sessions', click: () => openHistoryWindow() },
    { label: 'Settings', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit Nosey', click: () => app.quit() },
  ])
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) })
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  settingsFilePath = path.join(app.getPath('userData'), 'settings.json')
  loadAppSettings()
  // Older versions saved a fixed text model; the device profile owns that now
  delete appSettings.model
  useProfile(appSettings.profile)
  currentPersona = appSettings.persona
  currentMode = appSettings.mode
  createWindow()
  // The overlay is focusable: false, so keyboard shortcuts must be global
  // (keydown listeners in the page never fire in a window that cannot take focus)
  globalShortcut.register('Control+Shift+N', () => openAskWindow({ x: charX, y: charY }))
})

app.on('will-quit', () => globalShortcut.unregisterAll())

let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true
  closeSession(sessionId).finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
