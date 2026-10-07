import { describe, it, expect, vi } from 'vitest'

vi.mock('gsap', () => {
  const tween = { kill: vi.fn() }
  const tl = {
    to: vi.fn().mockReturnThis(),
    fromTo: vi.fn().mockReturnThis(),
    call: vi.fn().mockReturnThis(),
    kill: vi.fn(),
  }
  return {
    default: {
      to: vi.fn(() => tween),
      set: vi.fn(),
      fromTo: vi.fn(() => tween),
      timeline: vi.fn(() => tl),
    },
  }
})

const { setState } = await import('./nosey-animate.js')

describe('setState', () => {
  it('accepts idle without throwing', () => expect(() => setState('idle')).not.toThrow())
  it('accepts thinking without throwing', () => expect(() => setState('thinking')).not.toThrow())
  it('accepts talking without throwing', () => expect(() => setState('talking')).not.toThrow())
  it('accepts peeking without throwing', () => expect(() => setState('peeking')).not.toThrow())
  it('ignores unknown state without throwing', () =>
    expect(() => setState('unknown')).not.toThrow())
})
