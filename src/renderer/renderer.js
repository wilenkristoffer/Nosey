import { setState } from './character/nosey-animate.js'

let dragging = false
let uiConfig = {
  typewriterMs: 22,
  bubbleHideMs: 10000,
  startupErrorHideMs: 15000,
  processingUnlockMs: 15000,
  idlePeekMs: 300000,
}
window.electronAPI.getConfig().then((cfg) => {
  if (cfg) uiConfig = cfg
})

document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const isInteractive =
    dragging ||
    (el !== null && (el.closest('#nosey-character') !== null || el.closest('#bubble') !== null))
  window.electronAPI.setIgnoreMouse(!isInteractive)
})

document.addEventListener('mousedown', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  if (el !== null && el.closest('#nosey-character') !== null) {
    dragging = true
    window.electronAPI.dragStart()
  }
})

document.addEventListener('mouseup', () => {
  if (dragging) {
    dragging = false
    window.electronAPI.dragEnd()
    window.electronAPI.getPosition().then(([x, y]) => {
      localStorage.setItem('nosey-pos', JSON.stringify({ x, y }))
    })
  }
})

// Bubble
const bubbleWrapper = document.getElementById('bubble-wrapper')
const bubbleEl = document.getElementById('bubble')
const bubbleScroll = document.getElementById('bubble-scroll')
const bubbleText = document.getElementById('bubble-text')
const bubbleCloseBtn = document.getElementById('bubble-close')
const laughBtn = document.getElementById('laugh-btn')
let bubbleTimer = null
let isProcessing = false
let isExpanded = false
let currentCommentId = null
let isFunny = false

function showBubble() {
  clearTimeout(bubbleTimer)
  bubbleWrapper.classList.remove('hidden')
  window.electronAPI.setBubbleVisible(true)
}

// The main process widens the overlay window while the bubble is visible and
// reports which side it grew toward, since that depends on screen edges it
// alone knows about.
window.electronAPI.onBubbleAnchor((expandRight) => {
  document.body.classList.toggle('char-left', expandRight)
})

function collapseBubble() {
  isExpanded = false
  bubbleEl.classList.remove('expanded')
  bubbleCloseBtn.classList.add('hidden')
}

function expandBubble() {
  isExpanded = true
  clearTimeout(bubbleTimer)
  bubbleEl.classList.add('expanded')
  bubbleCloseBtn.classList.remove('hidden')
}

function hideBubble() {
  collapseBubble()
  bubbleWrapper.classList.add('hidden')
  laughBtn.classList.add('hidden')
  laughBtn.classList.remove('funny')
  currentCommentId = null
  isFunny = false
  window.electronAPI.setBubbleVisible(false)
}

// Click the bubble to expand long text; Nosey pauses while expanded so a
// window switch does not replace what the user is still reading
bubbleEl.addEventListener('click', (e) => {
  if (e.target.closest('#laugh-btn') || e.target.closest('#bubble-close')) return
  if (isExpanded) {
    collapseBubble()
    bubbleTimer = setTimeout(hideBubble, uiConfig.bubbleHideMs)
  } else {
    expandBubble()
  }
})

bubbleCloseBtn.addEventListener('click', () => {
  hideBubble()
})

laughBtn.addEventListener('click', () => {
  isFunny = !isFunny
  laughBtn.classList.toggle('funny', isFunny)
  if (currentCommentId) window.electronAPI.updateFunnyRating(currentCommentId, isFunny ? 1 : 0)
})

window.electronAPI.onCommentSaved(({ commentId }) => {
  currentCommentId = commentId
  isFunny = false
  laughBtn.classList.remove('funny')
  laughBtn.classList.remove('hidden')
})

// Typewriter
const typeQueue = []
let typeTimer = null
let typeResolve = null

function typeNextChar() {
  if (typeQueue.length === 0) {
    typeTimer = null
    if (typeResolve) {
      typeResolve()
      typeResolve = null
    }
    return
  }
  bubbleText.textContent += typeQueue.shift()
  bubbleScroll.scrollTop = bubbleScroll.scrollHeight
  typeTimer = setTimeout(typeNextChar, uiConfig.typewriterMs)
}

function queueText(text) {
  typeQueue.push(...text.split(''))
  if (!typeTimer) typeNextChar()
}

function waitForQueue() {
  if (typeQueue.length === 0 && !typeTimer) return Promise.resolve()
  return new Promise((resolve) => {
    typeResolve = resolve
  })
}

function clearTypeQueue() {
  typeQueue.length = 0
  if (typeTimer) {
    clearTimeout(typeTimer)
    typeTimer = null
  }
  typeResolve = null
}

// Right-click on character opens context menu
document.getElementById('character-container').addEventListener('contextmenu', () => {
  window.electronAPI.showContextMenu()
})

// Restore window position
const savedPos = JSON.parse(localStorage.getItem('nosey-pos') || 'null')
if (savedPos) {
  window.electronAPI.setPosition(savedPos.x, savedPos.y)
}

// Idle peek
let idlePeekTimer = null
function resetIdlePeek() {
  clearTimeout(idlePeekTimer)
  idlePeekTimer = setTimeout(() => {
    if (!isProcessing && !isExpanded) setState('peeking')
  }, uiConfig.idlePeekMs)
}

setState('idle')
resetIdlePeek()

// Startup events
window.electronAPI.onTriggerPeek(() => setState('peeking'))
window.electronAPI.onStartupError((msg) => {
  showBubble()
  bubbleText.textContent = msg
  bubbleTimer = setTimeout(hideBubble, uiConfig.startupErrorHideMs)
})

// Shared display flow for anything that streams into the bubble
// (capture-loop comments and Ask Nosey answers)
function beginResponseDisplay() {
  isProcessing = true
  resetIdlePeek()

  clearTypeQueue()
  hideBubble()
  bubbleText.textContent = ''
  setState('thinking')

  window.electronAPI.removeOllamaListeners()

  let tokenCount = 0

  window.electronAPI.onOllamaToken((token) => {
    // setState() kills and restarts the mouth tween, so calling it per-token
    // (tokens can arrive faster than one open/close cycle) never lets the
    // mouth complete a cycle -- it just sits open. Only (re)start once.
    if (tokenCount === 0) {
      showBubble()
      setState('talking')
    }
    tokenCount++
    queueText(token)
  })

  window.electronAPI.onOllamaDone(async () => {
    await waitForQueue()
    setState('idle')
    if (tokenCount === 0) {
      hideBubble()
      isProcessing = false
      return
    }
    // A click can expand the bubble before typing finishes (expandBubble can
    // only cancel a timer that already exists) -- re-check here so a mid-stream
    // expand still cancels the auto-hide.
    if (!isExpanded) {
      bubbleTimer = setTimeout(hideBubble, uiConfig.bubbleHideMs)
    }
    setTimeout(() => {
      isProcessing = false
    }, uiConfig.processingUnlockMs)
  })
}

// Main capture-and-comment loop
window.electronAPI.onScreenChanged(async (base64Image) => {
  if (isProcessing || isExpanded) return
  beginResponseDisplay()
  await window.electronAPI.startOllamaStream(base64Image)
})

// Ask Nosey: preempts whatever is on screen -- the user asked a direct question
window.electronAPI.onAskCountdown((n) => {
  isProcessing = true
  clearTypeQueue()
  clearTimeout(bubbleTimer)
  showBubble()
  bubbleText.textContent = `Show me the window! ${n}...`
  setState('peeking')
})

window.electronAPI.onAskStart(() => {
  beginResponseDisplay()
})
