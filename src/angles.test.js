import { describe, it, expect } from 'vitest'
import { ANGLES, pickAngle } from './angles.js'

describe('angles', () => {
  it('has a pool of at least 12 directives', () => {
    expect(ANGLES.length).toBeGreaterThanOrEqual(12)
  })

  it('pickAngle always returns a string from the pool', () => {
    for (let i = 0; i < 100; i++) {
      expect(ANGLES).toContain(pickAngle())
    }
  })

  it('pickAngle varies across many picks', () => {
    const seen = new Set()
    for (let i = 0; i < 200; i++) seen.add(pickAngle())
    expect(seen.size).toBeGreaterThan(1)
  })
})
