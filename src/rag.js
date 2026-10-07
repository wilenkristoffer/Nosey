const db = require('./db')
const config = require('./config')
const { postGenerate } = require('./ollama-client')

async function embedText(text) {
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.models.embed, prompt: text }),
    })
    if (!res.ok) throw new Error(`Ollama embeddings error ${res.status}`)
    const data = await res.json()
    return data.embedding
  } catch (err) {
    console.warn('[rag] embedText failed:', err.message)
    return null
  }
}

async function embedAndStore(commentId, text) {
  const embedding = await embedText(text)
  if (embedding) await db.updateEmbedding(commentId, embedding)
}

// Cuts at the last word boundary before maxLen instead of mid-word, so
// snippets fed back into prompts read as clean fragments, not "...virtual assi".
function truncateAtWord(str, maxLen) {
  if (str.length <= maxLen) return str
  const cut = str.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut
}

function formatStyleExamples(rows) {
  if (!rows || rows.length === 0) return null
  const examples = rows.map((r) => `- "${truncateAtWord(r.comment, config.rag.snippetLength)}"`)
  return `STYLE: The user found these past comments funny. Match this energy and sharpness, but do NOT reuse their content or subject:\n${examples.join('\n')}`
}

async function buildMemoryContext(currentSessionId, windowName, description, personaId) {
  const parts = []

  const queryText = description || windowName
  if (queryText && currentSessionId) {
    const embedding = await embedText(queryText)
    if (embedding) {
      const rows = await db.getSimilarPastComments(
        embedding,
        currentSessionId,
        config.rag.retrievalLimit,
        personaId
      )
      if (rows.length > 0) {
        const funnyFirst = [
          ...rows.filter((r) => r.funny_rating === 1),
          ...rows.filter((r) => r.funny_rating !== 1),
        ]
        const top = funnyFirst.slice(0, config.rag.topK)
        const snippets = top.map((r) => {
          const tag = r.funny_rating === 1 ? ' (marked funny)' : ''
          return `- "${truncateAtWord(r.comment, config.rag.snippetLength)}"${tag}`
        })
        parts.push(
          `DO NOT repeat or closely paraphrase these past observations about similar screens:\n${snippets.join('\n')}\nFind a completely different angle.`
        )
      }
    }
  }

  if (currentSessionId) {
    const recentComments = await db.getRecentSessionComments(
      currentSessionId,
      config.rag.recentLimit
    )
    const count = recentComments.length
    if (count > 0 && count < config.rag.sessionInlineThreshold) {
      const last3 = recentComments
        .slice(0, 3)
        .map((r) => `- "${truncateAtWord(r.comment, config.rag.commentContextLength)}"`)
      parts.push(
        `DO NOT repeat these comments already made this session:\n${last3.join('\n')}\nBe original.`
      )
    } else if (count >= config.rag.sessionInlineThreshold) {
      const summary = await db.getLatestSessionSummary(currentSessionId)
      if (summary)
        parts.push(
          `You have already observed this session: ${truncateAtWord(summary, config.rag.sessionContextLength)}\nDo not repeat yourself - find a fresh angle.`
        )
    }
  }

  const styleBlock = formatStyleExamples(await db.getFunnyComments(2, personaId))
  if (styleBlock) parts.push(styleBlock)

  if (parts.length === 0) return ''
  return `MEMORY:\n${parts.join('\n')}`
}

async function updateSessionSummary(sessionId, textModel, commentCount) {
  const comments = await db.getRecentSessionComments(sessionId, config.rag.recentLimit)
  if (comments.length < 3) return

  const list = comments
    .slice()
    .reverse()
    .map((c) => `- [${c.window_name || 'unknown'}] ${c.comment}`)
    .join('\n')

  const prompt =
    `Summarize in 2 sentences what this desktop spy character has observed in the current session. ` +
    `Be concise. Respond in English only. Here are the recent comments:\n${list}`

  try {
    const res = await postGenerate({
      model: textModel || config.models.text,
      prompt,
      stream: false,
      options: { num_predict: config.ollama.summaryTokens },
    })
    const data = await res.json()
    if (data.response) {
      await db.saveSessionSummary(sessionId, data.response.trim(), commentCount)
    }
  } catch (err) {
    console.warn('[rag] updateSessionSummary failed:', err.message)
  }
}

module.exports = {
  embedText,
  embedAndStore,
  buildMemoryContext,
  updateSessionSummary,
  formatStyleExamples,
}
