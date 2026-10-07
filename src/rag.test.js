import { describe, it, expect } from 'vitest'
import { formatStyleExamples } from './rag.js'

describe('formatStyleExamples', () => {
  it('returns null for empty or missing rows', () => {
    expect(formatStyleExamples([])).toBeNull()
    expect(formatStyleExamples(null)).toBeNull()
  })

  it('formats funny comments as a STYLE block', () => {
    const block = formatStyleExamples([
      { comment: 'Ah, the sacred ritual of pretending to read documentation.' },
      { comment: 'Bold of you to open a 14th browser tab.' },
    ])
    expect(block).toContain('STYLE:')
    expect(block).toContain('pretending to read documentation')
    expect(block).toContain('14th browser tab')
    expect(block).toContain('do NOT reuse')
  })

  it('truncates long comments to the configured snippet length', () => {
    const long = 'x'.repeat(500)
    const block = formatStyleExamples([{ comment: long }])
    expect(block.length).toBeLessThan(500)
  })
})
