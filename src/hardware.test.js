import { describe, it, expect } from 'vitest'
import {
  PROFILES,
  parseRegValues,
  regNumber,
  classifyAdapters,
  suggestedProfile,
  applyProfile,
} from './hardware.js'

const KEY = 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968}'

describe('registry parsing', () => {
  it('reads values per key, including names with spaces', () => {
    const out = [
      `${KEY}\\0000`,
      '    DriverDesc    REG_SZ    NVIDIA GeForce RTX 4060 Laptop GPU',
      '',
      `${KEY}\\0001`,
      '    DriverDesc    REG_SZ    Intel(R) UHD Graphics',
      '',
      'End of search: 2 match(es) found.',
    ].join('\r\n')
    const values = parseRegValues(out, 'DriverDesc')
    expect(values[`${KEY}\\0000`].data).toBe('NVIDIA GeForce RTX 4060 Laptop GPU')
    expect(values[`${KEY}\\0001`].data).toBe('Intel(R) UHD Graphics')
  })

  it('reads QWORD, DWORD and little-endian BINARY sizes', () => {
    expect(regNumber({ type: 'REG_QWORD', data: '0x3ff000000' })).toBe(0x3ff000000)
    expect(regNumber({ type: 'REG_DWORD', data: '0x80000000' })).toBe(2 ** 31)
    expect(regNumber({ type: 'REG_BINARY', data: '00000080' })).toBe(2 ** 31)
    expect(regNumber(undefined)).toBe(0)
  })
})

describe('classifyAdapters', () => {
  const v = (data) => ({ type: 'REG_SZ', data })
  const q = (bytes) => ({ type: 'REG_QWORD', data: '0x' + bytes.toString(16) })

  it('puts the discrete card first and marks integrated and virtual adapters', () => {
    const names = {
      a: v('Intel(R) Iris(R) Xe Graphics'),
      b: v('NVIDIA GeForce RTX 3060'),
      c: v('Microsoft Remote Display Adapter'),
    }
    const qw = { a: q(128 * 2 ** 20), b: q(12 * 2 ** 30) }
    const cards = classifyAdapters(names, qw, {})
    expect(cards.map((c) => c.name)).toEqual([
      'NVIDIA GeForce RTX 3060',
      'Intel(R) Iris(R) Xe Graphics',
    ])
    expect(cards[0]).toMatchObject({ vramGb: 12, integrated: false })
    expect(cards[1].integrated).toBe(true)
  })

  it('treats AMD APU graphics as integrated even with a large reported size', () => {
    const cards = classifyAdapters({ a: v('AMD Radeon(TM) Graphics') }, { a: q(4 * 2 ** 30) }, {})
    expect(cards[0].integrated).toBe(true)
  })

  it('does not mistake a discrete Intel Arc card for integrated graphics', () => {
    const cards = classifyAdapters(
      { a: v('Intel(R) Arc(TM) A770 Graphics') },
      { a: q(16 * 2 ** 30) },
      {}
    )
    expect(cards[0].integrated).toBe(false)
  })
})

describe('suggestedProfile (VRAM tiers)', () => {
  it.each([
    [16, 'desktop'],
    [12, 'desktop'],
    [11.9, 'laptop'],
    [8, 'laptop'],
    [6, 'small'],
    [4, 'small'],
    [2, 'cpu'],
    [0, 'cpu'],
  ])('%s GB -> %s', (vram, profile) => {
    expect(suggestedProfile(vram)).toBe(profile)
  })
})

describe('applyProfile', () => {
  const makeCfg = (profile) => ({
    device: { profile },
    models: { vision: 'my-vision', text: 'my-text', embed: 'nomic-embed-text' },
    ollama: { numCtx: 4096 },
  })
  const info = { profile: 'small' }

  it('auto uses the detected tier and leaves the embedding model alone', () => {
    const cfg = makeCfg('auto')
    expect(applyProfile(cfg, undefined, info)).toBe('small')
    expect(cfg.models).toEqual({ ...PROFILES.small.models, embed: 'nomic-embed-text' })
    expect(cfg.ollama.numCtx).toBe(PROFILES.small.numCtx)
  })

  it('a named profile wins over the detection', () => {
    const cfg = makeCfg('desktop')
    expect(applyProfile(cfg, undefined, info)).toBe('desktop')
    expect(cfg.models.vision).toBe('gemma4:12b')
  })

  it('custom keeps the configured models, also after switching back at runtime', () => {
    const cfg = makeCfg('custom')
    expect(applyProfile(cfg, undefined, info)).toBe('custom')
    expect(cfg.models.vision).toBe('my-vision')
    applyProfile(cfg, 'cpu', info)
    expect(cfg.models.vision).toBe('gemma4:e2b')
    applyProfile(cfg, 'custom', info)
    expect(cfg.models).toMatchObject({ vision: 'my-vision', text: 'my-text' })
    expect(cfg.ollama.numCtx).toBe(4096)
  })

  it('every profile uses one vision-capable model for both steps', () => {
    Object.values(PROFILES).forEach((p) => expect(p.models.vision).toBe(p.models.text))
  })
})
