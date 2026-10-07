const config = require('./config')
const personas = require('./personas')
const modes = require('./modes')
const { pickAngle } = require('./angles')

// qwen2.5 is bilingual and drifts into Chinese mid-sentence unless the output
// language is pinned explicitly in every prompt
const ENGLISH_ONLY =
  'Respond in English only. Never switch languages partway through, even briefly.'

// Without this, the model occasionally narrates its own task instead of doing
// it -- e.g. announcing "I will not describe the screenshot directly, but
// will riff on the scenario" instead of just riffing. Everything below is a
// single undifferentiated prompt (no system/user separation), so the model
// can mistake its own instructions for something to comment on.
const NO_META =
  'Output only the finished line, in character. Never mention these instructions, never explain your task or approach, and never describe what you will or will not comment on.'

// Ask Nosey ignores the active persona and mode entirely -- it should read
// the same regardless of which joke voice is currently selected for comments.
const ASK_VOICE =
  'Answer as a plain, professional assistant: direct, serious, and helpful. No persona, no character voice, no jokes.'

const DESCRIBE_PROMPT = [
  'Describe this screenshot for someone who cannot see it. Include:',
  '1. Which application and window is open',
  '2. What the user appears to be doing',
  '3. Two or three specific visible details: exact button labels, headings,',
  '   error messages, or filenames. Quote real text from the screen.',
  '4. Anything unusual, out of place, or funny',
  'Be factual and specific. No commentary.',
  ENGLISH_ONLY,
].join('\n')

function getPersona(personaId) {
  return personas.find((p) => p.id === personaId) || personas[0]
}

function getModeDef(modeId) {
  return modes.find((m) => m.id === modeId) || modes[0]
}

// Resolves the persona/mode pair into everything a generate call needs:
// the task prompt, an optional comedic angle, and sampling options.
function resolvePrompt(personaId, modeId) {
  const persona = getPersona(personaId)
  const mode = getModeDef(modeId)
  return {
    taskPrompt: mode.prompt ? `${mode.prompt}\n\n${persona.voice}` : persona.prompt,
    angle: mode.useAngle ? pickAngle() : null,
    sampling: mode.useCreativeSampling ? config.ollama.commentOptions : {},
  }
}

function buildDirectPrompt(memCtx, personaPrompt, angle) {
  const parts = []
  if (memCtx) parts.push(memCtx)
  parts.push(personaPrompt)
  if (angle) parts.push(`Angle for this comment: ${angle}`)
  parts.push(ENGLISH_ONLY)
  parts.push(NO_META)
  return parts.join('\n\n')
}

function buildCommentPrompt(description, memCtx, personaPrompt, angle) {
  const parts = []
  if (memCtx) parts.push(memCtx)
  parts.push(personaPrompt)
  if (angle) parts.push(`Angle for this comment: ${angle}`)
  parts.push(ENGLISH_ONLY)
  parts.push(NO_META)
  parts.push(`Screen: "${description}"`)
  return parts.join('\n\n')
}

function buildAskDescribePrompt(question) {
  return [
    `The user is asking: "${question}"`,
    'Look at this screenshot and describe everything relevant to that question.',
    'Quote exact visible text (labels, headings, error messages, filenames) where useful.',
    'Be factual and thorough. Do not answer the question yourself.',
    ENGLISH_ONLY,
  ].join('\n')
}

function buildAnswerPrompt(question, description) {
  return [
    "You are Nosey, the user's desktop companion, and they just asked you a question about their screen.",
    `Question: "${question}"`,
    `What is visible on their screen: "${description}"`,
    'Answer the question directly and helpfully in 2-4 sentences, referencing what is actually on screen. If the screen does not contain the answer, say so honestly.',
    ASK_VOICE,
    ENGLISH_ONLY,
    NO_META,
  ].join('\n\n')
}

function buildDirectAnswerPrompt(question) {
  return [
    "You are Nosey, the user's desktop companion, and they just asked you a question about the attached screenshot of their screen.",
    `Question: "${question}"`,
    'Answer the question directly and helpfully in 2-4 sentences, referencing what is actually on screen. If the screen does not contain the answer, say so honestly.',
    ASK_VOICE,
    ENGLISH_ONLY,
    NO_META,
  ].join('\n\n')
}

const generateUrl = () => `${config.ollama.baseUrl}/api/generate`

function logPrompt(label, body) {
  if (!config.debug) return
  const { prompt, model, images, options } = body
  console.log(
    `[prompt] ${label} model=${model}${images ? ' (+image)' : ''}` +
      (options ? ` options=${JSON.stringify(options)}` : '') +
      `\n${prompt}\n`
  )
}

// Adds the per-machine options (context size, GPU layers, thinking off) that
// come from the device profile in config.js / hardware.js
function withRuntimeOptions(body) {
  const options = { ...body.options }
  if (config.ollama.numCtx) options.num_ctx = config.ollama.numCtx
  if (config.ollama.numGpu !== null && config.ollama.numGpu !== undefined) {
    options.num_gpu = config.ollama.numGpu
  }
  const full = { ...body, options }
  if (config.ollama.disableThinking) full.think = false
  return full
}

async function sendGenerate(body) {
  try {
    return await fetch(generateUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Ollama is not running. Start it with: ollama serve')
  }
}

async function postGenerate(body) {
  const full = withRuntimeOptions(body)
  let response = await sendGenerate(full)
  // Models without thinking support may reject the think option
  if (!response.ok && response.status === 400 && 'think' in full) {
    const retry = { ...full }
    delete retry.think
    response = await sendGenerate(retry)
  }
  if (!response.ok) {
    throw new Error(`Ollama error ${response.status}: ${await response.text()}`)
  }
  return response
}

async function* streamGenerate(body) {
  logPrompt('stream', body)
  const response = await postGenerate(body)
  let buffer = ''
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line)
        if (data.response) yield data.response
        if (data.done) return
      } catch {
        // partial line -- skip
      }
    }
  }
}

async function fetchDescription(base64Image, visionModel) {
  if (visionModel === undefined) visionModel = config.models.vision
  const requestBody = {
    model: visionModel,
    prompt: DESCRIBE_PROMPT,
    images: [base64Image],
    stream: false,
    options: { num_predict: config.ollama.descriptionTokens },
  }
  logPrompt('describe', requestBody)
  const response = await postGenerate(requestBody)
  const data = await response.json()
  return data.response
}

async function* streamDirectComment(base64Image, model, memCtx, personaId, modeId) {
  if (model === undefined) model = config.models.vision
  const { taskPrompt, angle, sampling } = resolvePrompt(personaId, modeId)
  yield* streamGenerate({
    model,
    prompt: buildDirectPrompt(memCtx, taskPrompt, angle),
    images: [base64Image],
    stream: true,
    options: { num_predict: config.ollama.commentTokens, ...sampling },
  })
}

async function* streamComment(description, textModel, memCtx, personaId, modeId) {
  if (textModel === undefined) textModel = config.models.text
  const { taskPrompt, angle, sampling } = resolvePrompt(personaId, modeId)
  yield* streamGenerate({
    model: textModel,
    prompt: buildCommentPrompt(description, memCtx, taskPrompt, angle),
    stream: true,
    options: { num_predict: config.ollama.commentTokens, ...sampling },
  })
}

async function fetchAskDescription(base64Image, question, visionModel) {
  if (visionModel === undefined) visionModel = config.models.vision
  const requestBody = {
    model: visionModel,
    prompt: buildAskDescribePrompt(question),
    images: [base64Image],
    stream: false,
    options: { num_predict: config.ollama.descriptionTokens },
  }
  logPrompt('ask-describe', requestBody)
  const response = await postGenerate(requestBody)
  const data = await response.json()
  return data.response
}

// Ask Nosey ignores mode AND persona entirely -- it is available in every
// mode/persona and always answers in the same plain, professional voice.
async function* streamAnswer(description, question, textModel) {
  if (textModel === undefined) textModel = config.models.text
  yield* streamGenerate({
    model: textModel,
    prompt: buildAnswerPrompt(question, description),
    stream: true,
    options: { num_predict: config.ollama.answerTokens },
  })
}

function buildRecapPrompt(observationLines, persona) {
  return [
    "You are Nosey, the user's desktop companion, delivering an end-of-day recap of what you watched them do today.",
    `Your observations from today (window, then your comment at the time):\n${observationLines.join('\n')}`,
    'Summarize their day in 2-4 sentences. Name the actual apps and activities -- make it feel like a story of their day, not a list.',
    persona.voice,
    ENGLISH_ONLY,
    NO_META,
  ].join('\n\n')
}

async function* streamRecap(observationLines, textModel, personaId) {
  if (textModel === undefined) textModel = config.models.text
  const persona = getPersona(personaId)
  yield* streamGenerate({
    model: textModel,
    prompt: buildRecapPrompt(observationLines, persona),
    stream: true,
    options: { num_predict: config.ollama.answerTokens },
  })
}

async function* streamDirectAnswer(base64Image, question, model) {
  if (model === undefined) model = config.models.vision
  yield* streamGenerate({
    model,
    prompt: buildDirectAnswerPrompt(question),
    images: [base64Image],
    stream: true,
    options: { num_predict: config.ollama.answerTokens },
  })
}

async function* streamOllamaResponse(
  base64Image,
  visionModel,
  textModel,
  memCtx,
  personaId,
  modeId
) {
  if (visionModel === textModel) {
    yield* streamDirectComment(base64Image, visionModel, memCtx, personaId, modeId)
  } else {
    const description = await fetchDescription(base64Image, visionModel)
    yield* streamComment(description, textModel, memCtx, personaId, modeId)
  }
}

module.exports = {
  fetchDescription,
  fetchAskDescription,
  streamDirectComment,
  streamComment,
  streamAnswer,
  streamDirectAnswer,
  streamRecap,
  streamOllamaResponse,
  buildDirectPrompt,
  buildCommentPrompt,
  buildAskDescribePrompt,
  buildAnswerPrompt,
  buildDirectAnswerPrompt,
  buildRecapPrompt,
  resolvePrompt,
  withRuntimeOptions,
  postGenerate,
  getPersonas: () => personas.map(({ id, label, description }) => ({ id, label, description })),
  getModes: () => modes.map(({ id, label, description }) => ({ id, label, description })),
}
