// What this computer has (graphics card, memory, processor) and which device
// profile suits it.
//
// A device profile picks the Ollama model and context size that fit a kind of
// computer. The model wants its whole size plus the context in the graphics
// card's own memory (VRAM); if it does not fit, Ollama runs part of it on the
// processor and it gets many times slower.
//
// Chosen with device.profile in config.js (or Device Profile in Settings):
// 'auto' picks from the detected hardware, 'custom' keeps the models written in
// config.js as they are. See the Requirements section of README.md.

const { execFileSync } = require('child_process')
const os = require('os')

const DISPLAY_CLASS =
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'

// ACPI "Control Method Battery": present on practically every laptop
const BATTERY_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Enum\\ACPI\\PNP0C0A'

// Display adapters that are not real graphics cards (remote desktop, virtual
// displays, screen capture drivers)
const NOT_A_GPU = [
  'basic display',
  'basic render',
  'remote',
  'virtual',
  'parsec',
  'citrix',
  'vmware',
  'hyper-v',
  'idd',
  'spacedesk',
  'displaylink',
  'mirage',
]

// Integrated graphics share main memory, and Windows reports a small or
// made-up amount of VRAM for them
const INTEGRATED = [
  'intel(r) uhd',
  'intel(r) hd',
  'intel(r) iris',
  'iris(r) xe',
  'intel(r) arc(tm) graphics',
  'radeon(tm) graphics',
  'radeon graphics',
  'radeon(tm) vega',
  'radeon vega',
  'radeon 7',
  'radeon 8',
]

const GB = 2 ** 30

// Measured VRAM while generating (Windows "GPU Adapter Memory\Dedicated Usage",
// num_ctx 16384): gemma4:12b 9.0 GB, gemma4:e4b 5.6 GB, gemma4:e2b 3.9 GB.
// Windows uses another 1-2 GB of the card that drives the display. Nosey runs
// with num_ctx 8192, so its use is at or below these numbers.
const PROFILES = {
  desktop: {
    label: 'Desktop GPU (12 GB+)',
    models: { vision: 'gemma4:12b', text: 'gemma4:12b' },
    numCtx: 8192,
  },
  laptop: {
    label: 'Laptop GPU (8-12 GB)',
    models: { vision: 'gemma4:e4b', text: 'gemma4:e4b' },
    numCtx: 8192,
  },
  small: {
    label: 'Small GPU (4-8 GB)',
    models: { vision: 'gemma4:e2b', text: 'gemma4:e2b' },
    numCtx: 8192,
  },
  cpu: {
    label: 'No GPU (processor only)',
    // e2b over e4b: on the processor, reading the screenshot takes most of the time,
    // and e2b starts its comment about 3.5 s sooner (9.5 s against 12.9 s on a 6-core
    // desktop CPU) with comments that were just as specific. A comment only helps while
    // you are still on that window.
    models: { vision: 'gemma4:e2b', text: 'gemma4:e2b' },
    numCtx: 8192,
  },
}

const PROFILE_NAMES = ['auto', ...Object.keys(PROFILES), 'custom']

function regQuery(args) {
  try {
    return execFileSync('reg', ['query', ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
  } catch {
    // reg exits with 1 when nothing matches, and does not exist outside Windows
    return ''
  }
}

// Parses `reg query <key> /s /v <name>` output into { keyPath: { type, data } }
function parseRegValues(output, valueName) {
  const result = {}
  let key = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) {
      key = line.trim()
      continue
    }
    const match = line.match(/^\s+(\S+)\s+(REG_\w+)\s*(.*)$/)
    if (key && match && match[1].toLowerCase() === valueName.toLowerCase()) {
      result[key] = { type: match[2], data: match[3].trim() }
    }
  }
  return result
}

// REG_DWORD / REG_QWORD come as 0x-hex, REG_BINARY as little-endian hex bytes
function regNumber(value) {
  if (!value) return 0
  try {
    if (value.type === 'REG_BINARY') {
      const bytes = value.data.match(/../g) || []
      return Number(BigInt('0x' + (bytes.reverse().join('') || '0')))
    }
    return Number(BigInt(value.data))
  } catch {
    return 0
  }
}

function classifyAdapters(names, qwSizes, sizes) {
  const found = {}
  for (const [key, value] of Object.entries(names)) {
    const name = value.data.trim()
    const low = name.toLowerCase()
    if (!name || NOT_A_GPU.some((word) => low.includes(word))) continue
    const vram = regNumber(qwSizes[key]) || regNumber(sizes[key])
    const integrated = INTEGRATED.some((word) => low.includes(word)) || vram < 2 * GB
    found[name] = { name, vramGb: Math.round((vram / GB) * 10) / 10, integrated }
  }
  return Object.values(found).sort(
    (a, b) => Number(!b.integrated) - Number(!a.integrated) || b.vramGb - a.vramGb
  )
}

// [{ name, vramGb, integrated }] from the Windows registry, discrete cards
// with the most VRAM first
function gpus() {
  const query = (valueName) =>
    parseRegValues(regQuery([DISPLAY_CLASS, '/s', '/v', valueName]), valueName)
  return classifyAdapters(
    query('DriverDesc'),
    query('HardwareInformation.qwMemorySize'),
    query('HardwareInformation.MemorySize')
  )
}

function hasBattery() {
  return regQuery([BATTERY_KEY]).trim().length > 0
}

function suggestedProfile(vramGb) {
  if (vramGb >= 12) return 'desktop'
  if (vramGb >= 8) return 'laptop'
  if (vramGb >= 4) return 'small'
  return 'cpu'
}

let cachedInfo = null

function detect() {
  if (cachedInfo) return cachedInfo
  const cards = gpus()
  const best = cards.find((g) => !g.integrated) || null
  const info = {
    gpus: cards,
    gpu: best ? best.name : null,
    vramGb: best ? best.vramGb : 0,
    ramGb: Math.round(os.totalmem() / GB),
    threads: os.cpus().length || 4,
    laptop: hasBattery(),
  }
  info.profile = suggestedProfile(info.vramGb)
  cachedInfo = info
  return info
}

function describe(info) {
  const gpu = info.gpu ? `${info.gpu} (${Math.round(info.vramGb)} GB)` : 'no separate graphics card'
  const kind = info.laptop ? 'laptop' : 'computer'
  return `${gpu}, ${info.ramGb} GB RAM, ${info.threads} threads (${kind})`
}

// The profile name in use, or null for 'custom'
function resolveProfile(name, info) {
  if (name === 'custom') return null
  if (PROFILES[name]) return name
  return (info || detect()).profile
}

// Fills cfg.models and cfg.ollama.numCtx from the profile (in place). The
// values written in config.js are kept in cfg.device.manual so switching back
// to 'custom' at runtime restores them. Returns the active profile name.
function applyProfile(cfg, name, info) {
  if (!cfg.device) cfg.device = {}
  if (!cfg.device.manual) {
    cfg.device.manual = { models: { ...cfg.models }, numCtx: cfg.ollama.numCtx }
  }
  const requested = name || cfg.device.profile || 'auto'
  const active = resolveProfile(requested, info)
  if (active) {
    Object.assign(cfg.models, PROFILES[active].models)
    cfg.ollama.numCtx = PROFILES[active].numCtx
  } else {
    Object.assign(cfg.models, cfg.device.manual.models)
    cfg.ollama.numCtx = cfg.device.manual.numCtx
  }
  cfg.device.requested = requested
  cfg.device.active = active || 'custom'
  return cfg.device.active
}

module.exports = {
  PROFILES,
  PROFILE_NAMES,
  parseRegValues,
  regNumber,
  classifyAdapters,
  gpus,
  hasBattery,
  suggestedProfile,
  detect,
  describe,
  resolveProfile,
  applyProfile,
}
