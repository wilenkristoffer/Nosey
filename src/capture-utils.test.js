import { describe, it, expect } from 'vitest'
import { sampleHash, samplePixels, diffRatio } from './capture-utils.js'

describe('sampleHash', () => {
  it('returns a hex string', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    expect(sampleHash(buf)).toMatch(/^[0-9a-f]+$/)
  })

  it('returns the same hash for identical buffers', () => {
    const a = Buffer.from([10, 20, 30, 40, 50])
    const b = Buffer.from([10, 20, 30, 40, 50])
    expect(sampleHash(a)).toBe(sampleHash(b))
  })

  it('returns different hashes for different buffers', () => {
    const a = Buffer.from([1, 2, 3])
    const b = Buffer.from([4, 5, 6])
    expect(sampleHash(a)).not.toBe(sampleHash(b))
  })

  it('handles empty buffer without crashing', () => {
    expect(() => sampleHash(Buffer.alloc(0))).not.toThrow()
  })
})

describe('samplePixels', () => {
  it('returns average brightness per sampled pixel', () => {
    const bitmap = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255])
    const samples = samplePixels(bitmap, 1)
    expect(samples).toHaveLength(3)
    expect(samples[0]).toBeCloseTo(85)
    expect(samples[2]).toBeCloseTo(255)
  })

  it('handles empty buffer', () => {
    expect(samplePixels(Buffer.alloc(0))).toEqual([])
  })
})

describe('diffRatio', () => {
  it('returns 1 when prev is null', () => {
    expect(diffRatio(null, [100, 200])).toBe(1)
  })

  it('returns 0 for identical samples', () => {
    expect(diffRatio([100, 200, 150], [100, 200, 150])).toBe(0)
  })

  it('returns 1 for completely different samples (above threshold)', () => {
    expect(diffRatio([0, 0, 0], [255, 255, 255])).toBe(1)
  })

  it('returns 1 when array lengths differ', () => {
    expect(diffRatio([100], [100, 200])).toBe(1)
  })
})
