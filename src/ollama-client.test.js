import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildDirectPrompt,
  buildCommentPrompt,
  buildAskDescribePrompt,
  buildAnswerPrompt,
  buildDirectAnswerPrompt,
  buildRecapPrompt,
  resolvePrompt,
} from './ollama-client.js'
import personas from './personas.js'
import modeDefs from './modes.js'
import { ANGLES } from './angles.js'
import config from './config.js'

describe('resolvePrompt (mode + persona composition)', () => {
  it('commentary mode uses the persona prompt verbatim with an angle and creative sampling', () => {
    const { taskPrompt, angle, sampling } = resolvePrompt('classic', 'commentary')
    expect(taskPrompt).toBe(personas[0].prompt)
    expect(taskPrompt).not.toContain(personas[0].voice)
    expect(ANGLES).toContain(angle)
    expect(sampling).toEqual(config.ollama.commentOptions)
  })

  it('coach mode owns the task, persona contributes only its voice, no angle, default sampling', () => {
    const coach = modeDefs.find((m) => m.id === 'coach')
    const yoda = personas.find((p) => p.id === 'yoda')
    const { taskPrompt, angle, sampling } = resolvePrompt('yoda', 'coach')
    expect(taskPrompt).toContain(coach.prompt)
    expect(taskPrompt).toContain(yoda.voice)
    expect(taskPrompt).not.toContain(yoda.prompt)
    expect(angle).toBeNull()
    expect(sampling).toEqual({})
  })

  it('quest mode gets an angle and creative sampling', () => {
    const { angle, sampling } = resolvePrompt('classic', 'quest')
    expect(ANGLES).toContain(angle)
    expect(sampling).toEqual(config.ollama.commentOptions)
  })

  it('focus mode gets no angle and default sampling', () => {
    const { angle, sampling } = resolvePrompt('classic', 'focus')
    expect(angle).toBeNull()
    expect(sampling).toEqual({})
  })

  it('unknown persona or mode falls back to defaults', () => {
    const { taskPrompt } = resolvePrompt('nope', 'nope')
    expect(taskPrompt).toBe(personas[0].prompt)
  })

  it('every non-commentary mode has a prompt and every persona has a voice', () => {
    modeDefs
      .filter((m) => m.id !== 'commentary')
      .forEach((m) => expect(typeof m.prompt).toBe('string'))
    personas.forEach((p) => expect(typeof p.voice).toBe('string'))
  })
})

describe('prompt builders', () => {
  const persona = 'You are Nosey.'
  const angle = 'Zoom in on one detail.'

  it('buildCommentPrompt includes persona, angle, and description', () => {
    const prompt = buildCommentPrompt('user is coding', null, persona, angle)
    expect(prompt).toContain(persona)
    expect(prompt).toContain(`Angle for this comment: ${angle}`)
    expect(prompt).toContain('Screen: "user is coding"')
  })

  it('buildCommentPrompt puts memory context first when present', () => {
    const prompt = buildCommentPrompt('desc', 'MEMORY: stuff', persona, angle)
    expect(prompt.startsWith('MEMORY: stuff')).toBe(true)
  })

  it('buildCommentPrompt omits angle block when no angle given', () => {
    const prompt = buildCommentPrompt('desc', null, persona, null)
    expect(prompt).not.toContain('Angle for this comment')
  })

  it('buildDirectPrompt includes persona and angle without a screen block', () => {
    const prompt = buildDirectPrompt(null, persona, angle)
    expect(prompt).toContain(persona)
    expect(prompt).toContain(`Angle for this comment: ${angle}`)
    expect(prompt).not.toContain('Screen:')
  })
})

describe('Ask Nosey prompt builders', () => {
  const question = 'What does this error mean?'
  const persona = personas.find((p) => p.id === 'classic')

  it('buildAskDescribePrompt embeds the question and demands quoted text', () => {
    const prompt = buildAskDescribePrompt(question)
    expect(prompt).toContain(question)
    expect(prompt).toContain('Quote exact visible text')
    expect(prompt).toContain('Do not answer the question yourself')
  })

  it('buildAnswerPrompt includes question, description, and a plain professional voice', () => {
    const prompt = buildAnswerPrompt(question, 'a stack trace in VS Code')
    expect(prompt).toContain(question)
    expect(prompt).toContain('a stack trace in VS Code')
    expect(prompt).toContain('plain, professional assistant')
  })

  it('buildDirectAnswerPrompt includes question and a plain professional voice, no description block', () => {
    const prompt = buildDirectAnswerPrompt(question)
    expect(prompt).toContain(question)
    expect(prompt).toContain('plain, professional assistant')
    expect(prompt).not.toContain('What is visible on their screen')
  })

  it('answer prompts never mention modes -- Ask Nosey works in every mode', () => {
    const prompt = buildAnswerPrompt(question, 'desc')
    expect(prompt).not.toMatch(/\bmode\b/i)
  })

  it('answer prompts never adopt any persona voice, regardless of the active persona', () => {
    const prompt = buildAnswerPrompt(question, 'desc') + buildDirectAnswerPrompt(question)
    personas.forEach((p) => expect(prompt).not.toContain(p.voice))
  })

  it('buildRecapPrompt includes the observations and persona voice', () => {
    const prompt = buildRecapPrompt(['- [Excel] Fighting spreadsheets again.'], persona)
    expect(prompt).toContain('[Excel] Fighting spreadsheets again.')
    expect(prompt).toContain('recap')
    expect(prompt).toContain(persona.voice)
  })
})

describe('language pinning (qwen drifts into Chinese without it)', () => {
  const persona = personas[0]

  it('every generation prompt carries the English-only instruction', () => {
    const prompts = [
      buildDirectPrompt('mem', 'task', 'angle'),
      buildCommentPrompt('desc', 'mem', 'task', 'angle'),
      buildAskDescribePrompt('q'),
      buildAnswerPrompt('q', 'desc'),
      buildDirectAnswerPrompt('q'),
      buildRecapPrompt(['- [App] comment'], persona),
    ]
    prompts.forEach((p) => expect(p).toContain('Respond in English only.'))
  })

  it('comment temperature stays at or below 1.0', () => {
    expect(config.ollama.commentOptions.temperature).toBeLessThanOrEqual(1.0)
  })
})

describe('streamOllamaResponse error handling', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('throws a descriptive error when Ollama is not reachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const { streamOllamaResponse } = await import('./ollama-client.js')

    const gen = streamOllamaResponse('fake-base64', 'moondream', 'qwen2.5:3b')
    await expect(gen.next()).rejects.toThrow('Ollama is not running')
  })

  it('throws when the vision model returns a non-200 status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })
    const { streamOllamaResponse } = await import('./ollama-client.js')

    const gen = streamOllamaResponse('fake-base64', 'moondream', 'qwen2.5:3b')
    await expect(gen.next()).rejects.toThrow('Ollama error 500')
  })
})

describe('runtime options from the device profile', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('adds num_ctx and think: false, and keeps the per-call options', async () => {
    const { withRuntimeOptions } = await import('./ollama-client.js')
    const body = withRuntimeOptions({ model: 'm', prompt: 'p', options: { num_predict: 5 } })
    expect(body.options).toMatchObject({ num_predict: 5, num_ctx: config.ollama.numCtx })
    expect(body.think).toBe(false)
    expect('num_gpu' in body.options).toBe(config.ollama.numGpu !== null)
  })

  it('retries without think when the model rejects the option', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'does not support thinking',
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: 'a screen' }) })
    const { fetchDescription } = await import('./ollama-client.js')

    await expect(fetchDescription('img', 'some-model')).resolves.toBe('a screen')
    const retried = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect('think' in retried).toBe(false)
    expect(retried.options.num_ctx).toBe(config.ollama.numCtx)
  })
})
