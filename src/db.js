const { Pool } = require('pg')
const config = require('./config')

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
})

let dbEnabled = false

async function initDb() {
  try {
    const client = await pool.connect()
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector')
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id             SERIAL PRIMARY KEY,
          started_at     TIMESTAMPTZ DEFAULT NOW(),
          ended_at       TIMESTAMPTZ,
          total_comments INTEGER DEFAULT 0
        )
      `)
      await client.query(`
        CREATE TABLE IF NOT EXISTS comments (
          id           SERIAL PRIMARY KEY,
          session_id   INTEGER REFERENCES sessions(id),
          created_at   TIMESTAMPTZ DEFAULT NOW(),
          window_name  TEXT,
          description  TEXT,
          comment      TEXT NOT NULL,
          model_vision TEXT,
          model_text   TEXT,
          mode         TEXT,
          duration_ms  INTEGER,
          token_count  INTEGER,
          funny_rating INTEGER DEFAULT 0,
          embedding    vector(${config.db.embeddingDimension})
        )
      `)
      await client.query(`
        CREATE TABLE IF NOT EXISTS session_summaries (
          id                       SERIAL PRIMARY KEY,
          session_id               INTEGER REFERENCES sessions(id),
          created_at               TIMESTAMPTZ DEFAULT NOW(),
          summary                  TEXT,
          comment_count_at_summary INTEGER
        )
      `)
      await client.query(
        `CREATE INDEX IF NOT EXISTS comments_embedding_idx ON comments USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${config.db.ivfflatLists})`
      )
      // Additive, idempotent migration for Ask Nosey (phase 7)
      await client.query(
        `ALTER TABLE comments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment'`
      )
      await client.query(`ALTER TABLE comments ADD COLUMN IF NOT EXISTS question TEXT`)
      await client.query(`ALTER TABLE comments ADD COLUMN IF NOT EXISTS persona TEXT`)
      dbEnabled = true
      console.log('[db] connected and schema ready')
    } finally {
      client.release()
    }
  } catch (err) {
    console.warn('[db] Postgres unavailable, persistence disabled:', err.message)
    dbEnabled = false
  }
}

async function openSession() {
  if (!dbEnabled) return null
  try {
    const res = await pool.query('INSERT INTO sessions DEFAULT VALUES RETURNING id')
    return res.rows[0].id
  } catch (err) {
    console.warn('[db] openSession failed:', err.message)
    return null
  }
}

async function closeSession(sessionId) {
  if (!dbEnabled || !sessionId) return
  try {
    await pool.query(
      `UPDATE sessions
       SET ended_at = NOW(),
           total_comments = (SELECT COUNT(*) FROM comments WHERE session_id = $1)
       WHERE id = $1`,
      [sessionId]
    )
  } catch (err) {
    console.warn('[db] closeSession failed:', err.message)
  }
}

async function saveComment(sessionId, data) {
  if (!dbEnabled || !sessionId) return null
  const {
    windowName,
    description,
    comment,
    modelVision,
    modelText,
    mode,
    persona,
    durationMs,
    tokenCount,
    kind,
    question,
  } = data
  try {
    const res = await pool.query(
      `INSERT INTO comments
         (session_id, window_name, description, comment, model_vision, model_text, mode, persona, duration_ms, token_count, kind, question)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        sessionId,
        windowName,
        description || null,
        comment,
        modelVision,
        modelText,
        mode,
        persona || null,
        durationMs,
        tokenCount,
        kind || 'comment',
        question || null,
      ]
    )
    return res.rows[0].id
  } catch (err) {
    console.warn('[db] saveComment failed:', err.message)
    return null
  }
}

async function updateEmbedding(commentId, embedding) {
  if (!dbEnabled || !commentId) return
  try {
    await pool.query('UPDATE comments SET embedding = $1 WHERE id = $2', [
      JSON.stringify(embedding),
      commentId,
    ])
  } catch (err) {
    console.warn('[db] updateEmbedding failed:', err.message)
  }
}

// CJK ranges catch the qwen2.5 language-drift bug (see config.js comment on
// commentOptions.temperature) so a garbled bilingual comment can never be
// marked funny and re-served as a STYLE example.
const CJK_PATTERN = /[一-鿿぀-ヿ가-힣]/

async function updateFunnyRating(commentId, funny) {
  if (!dbEnabled || !commentId) return
  try {
    await pool.query(
      `UPDATE comments SET funny_rating = $1
       WHERE id = $2 AND ($1 = 0 OR comment !~ $3)`,
      [funny, commentId, CJK_PATTERN.source]
    )
  } catch (err) {
    console.warn('[db] updateFunnyRating failed:', err.message)
  }
}

async function getRecentSessionComments(sessionId, limit = config.rag.recentLimit) {
  if (!dbEnabled || !sessionId) return []
  try {
    const res = await pool.query(
      `SELECT id, comment, window_name, created_at FROM comments
       WHERE session_id = $1 AND kind = 'comment'
       ORDER BY created_at DESC LIMIT $2`,
      [sessionId, limit]
    )
    return res.rows
  } catch (err) {
    console.warn('[db] getRecentSessionComments failed:', err.message)
    return []
  }
}

async function getSimilarPastComments(
  embedding,
  currentSessionId,
  limit = config.rag.retrievalLimit,
  personaId
) {
  if (!dbEnabled) return []
  try {
    const res = await pool.query(
      `SELECT comment, funny_rating, window_name
       FROM comments
       WHERE session_id != $1 AND embedding IS NOT NULL AND kind = 'comment'
         AND comment !~ $5
         AND ($4::text IS NULL OR persona = $4)
       ORDER BY embedding <=> $2
       LIMIT $3`,
      [currentSessionId, JSON.stringify(embedding), limit, personaId || null, CJK_PATTERN.source]
    )
    return res.rows
  } catch (err) {
    console.warn('[db] getSimilarPastComments failed:', err.message)
    return []
  }
}

async function getFunnyComments(limit = 2, personaId) {
  if (!dbEnabled) return []
  try {
    // Random pick keeps the style examples varied between comments.
    // CJK_PATTERN excludes qwen2.5 language-drift garbage from ever being
    // served back as a "match this energy" example.
    const res = await pool.query(
      `SELECT comment FROM comments
       WHERE funny_rating = 1 AND kind = 'comment' AND comment !~ $3
         AND ($2::text IS NULL OR persona = $2)
       ORDER BY random() LIMIT $1`,
      [limit, personaId || null, CJK_PATTERN.source]
    )
    return res.rows
  } catch (err) {
    console.warn('[db] getFunnyComments failed:', err.message)
    return []
  }
}

async function saveSessionSummary(sessionId, summary, commentCount) {
  if (!dbEnabled || !sessionId) return
  try {
    await pool.query(
      `INSERT INTO session_summaries (session_id, summary, comment_count_at_summary)
       VALUES ($1, $2, $3)`,
      [sessionId, summary, commentCount]
    )
  } catch (err) {
    console.warn('[db] saveSessionSummary failed:', err.message)
  }
}

async function getLatestSessionSummary(sessionId) {
  if (!dbEnabled || !sessionId) return null
  try {
    const res = await pool.query(
      `SELECT summary FROM session_summaries
       WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [sessionId]
    )
    return res.rows[0]?.summary || null
  } catch (err) {
    console.warn('[db] getLatestSessionSummary failed:', err.message)
    return null
  }
}

async function getTodaysComments() {
  if (!dbEnabled) return []
  try {
    // All sessions since local midnight, not just the current one
    const res = await pool.query(
      `SELECT window_name, comment, created_at FROM comments
       WHERE created_at >= date_trunc('day', NOW()) AND kind = 'comment'
       ORDER BY created_at ASC`
    )
    return res.rows
  } catch (err) {
    console.warn('[db] getTodaysComments failed:', err.message)
    return []
  }
}

async function getSessions() {
  if (!dbEnabled) return []
  try {
    const res = await pool.query(
      `SELECT s.id, s.started_at, s.ended_at,
              COUNT(c.id)::int AS total_comments
       FROM sessions s
       LEFT JOIN comments c ON c.session_id = s.id
       GROUP BY s.id
       ORDER BY s.started_at DESC`
    )
    return res.rows
  } catch (err) {
    console.warn('[db] getSessions failed:', err.message)
    return []
  }
}

async function getSessionComments(sessionId) {
  if (!dbEnabled || !sessionId) return []
  try {
    const res = await pool.query(
      `SELECT id, created_at, window_name, description, comment, mode, funny_rating, token_count, kind, question
       FROM comments WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    )
    return res.rows
  } catch (err) {
    console.warn('[db] getSessionComments failed:', err.message)
    return []
  }
}

module.exports = {
  initDb,
  openSession,
  closeSession,
  saveComment,
  updateEmbedding,
  updateFunnyRating,
  getRecentSessionComments,
  getSimilarPastComments,
  getFunnyComments,
  saveSessionSummary,
  getLatestSessionSummary,
  getTodaysComments,
  getSessions,
  getSessionComments,
}
