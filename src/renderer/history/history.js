const sessionList = document.getElementById('session-list')
const commentList = document.getElementById('comment-list')
const mainHeader = document.getElementById('main-header')

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function fmtDuration(start, end) {
  if (!end) return 'active'
  const ms = new Date(end) - new Date(start)
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

async function loadSessions() {
  const sessions = await window.historyAPI.getSessions()
  if (!sessions.length) {
    sessionList.innerHTML = '<div class="empty" style="padding:20px 16px">No sessions yet.</div>'
    return
  }

  sessionList.innerHTML = sessions
    .map((s) => {
      const isActive = !s.ended_at
      const duration = fmtDuration(s.started_at, s.ended_at)
      return `
      <div class="session-item" data-id="${s.id}">
        <div class="session-date">
          ${fmtDate(s.started_at)}
          ${isActive ? '<span class="session-active-badge">live</span>' : ''}
        </div>
        <div class="session-meta">
          ${fmtTime(s.started_at)} &middot; ${s.total_comments || 0} comments &middot; ${duration}
        </div>
      </div>`
    })
    .join('')

  sessionList.querySelectorAll('.session-item').forEach((el) => {
    el.addEventListener('click', () => {
      sessionList.querySelectorAll('.session-item').forEach((x) => x.classList.remove('active'))
      el.classList.add('active')
      loadComments(parseInt(el.dataset.id))
    })
  })

  const first = sessionList.querySelector('.session-item')
  if (first) first.click()
}

async function loadComments(sessionId) {
  commentList.innerHTML = '<div class="empty">Loading...</div>'
  const comments = await window.historyAPI.getSessionComments(sessionId)

  const session = document.querySelector(`.session-item[data-id="${sessionId}"]`)
  const dateText = session
    ? session.querySelector('.session-date').textContent.trim().split('\n')[0].trim()
    : ''
  mainHeader.textContent = dateText
    ? `${dateText} - ${comments.length} comments`
    : `${comments.length} comments`

  if (!comments.length) {
    commentList.innerHTML = '<div class="empty">No comments in this session.</div>'
    return
  }

  commentList.innerHTML = comments
    .map((c) => {
      const isFunny = c.funny_rating === 1
      const isAnswer = c.kind === 'answer'
      const hasDesc = c.description && c.mode === 'two-model'
      const descId = `desc-${c.id}`
      return `
      <div class="comment-card ${isFunny ? 'funny' : ''}">
        <div class="comment-top">
          <span class="comment-time">${fmtTime(c.created_at)}</span>
          ${c.window_name ? `<span class="comment-window" title="${c.window_name}">${c.window_name}</span>` : ''}
          ${isFunny ? '<span class="funny-badge" title="Marked funny">&#128514;</span>' : ''}
        </div>
        ${isAnswer && c.question ? `<div class="question-text">You asked: ${c.question}</div>` : ''}
        <div class="comment-text">${c.comment}</div>
        ${
          hasDesc
            ? `<div class="description-toggle" onclick="toggleDesc('${descId}')">show vision description</div>
               <div class="description-text" id="${descId}">${c.description}</div>`
            : ''
        }
      </div>`
    })
    .join('')
}

function toggleDesc(id) {
  const el = document.getElementById(id)
  if (!el) return
  el.classList.toggle('visible')
  const toggle = el.previousElementSibling
  toggle.textContent = el.classList.contains('visible')
    ? 'hide vision description'
    : 'show vision description'
}

window.toggleDesc = toggleDesc

loadSessions()
