// Central configuration for Nosey.
// Change settings here — no need to hunt through individual source files.

module.exports = {
  // ---------------------------------------------------------------------------
  // Debug
  //   When true, prints prompts/responses sent to and from Ollama to the
  //   console and saves screenshots/descriptions/comments to a debug folder in
  //   the app's user data directory (%APPDATA%\Nosey\debug). Those files contain
  //   whatever was on your screen -- keep this off unless you are debugging.
  // ---------------------------------------------------------------------------
  debug: false,

  // ---------------------------------------------------------------------------
  // Device profile
  //   Picks the Ollama model and context size that fit this computer
  //   (see src/hardware.js and the Requirements section of README.md):
  //     'auto'    -- detect the graphics card and choose (default)
  //     'desktop' -- 12 GB+ VRAM: gemma4:12b
  //     'laptop'  -- 8-12 GB VRAM: gemma4:e4b
  //     'small'   -- 4-8 GB VRAM: gemma4:e2b
  //     'cpu'     -- no usable GPU: gemma4:e4b on the processor
  //     'custom'  -- use models.vision / models.text and ollama.numCtx below as written
  //   Can be changed live in Settings (saved per user, overrides this default).
  // ---------------------------------------------------------------------------
  device: {
    profile: 'auto',
  },

  // ---------------------------------------------------------------------------
  // Default personality
  //   Must match an id in src/personas.js. Can be changed live via the settings panel.
  // ---------------------------------------------------------------------------
  defaultPersona: 'classic',

  // ---------------------------------------------------------------------------
  // Default mode
  //   What Nosey does with what it sees; the persona is the voice it uses.
  //   Must match an id in src/modes.js. Can be changed live via the settings panel.
  // ---------------------------------------------------------------------------
  defaultMode: 'commentary',

  // ---------------------------------------------------------------------------
  // Pipeline mode
  //   'single'    — one vision+language model handles everything (faster, less accurate)
  //   'two-model' — vision model describes the screen, text model writes the comment
  //                 (slower, much better instruction following and wit)
  //   The pipeline actually used follows the models: when models.vision and
  //   models.text are the same (every device profile), it is 'single'.
  // ---------------------------------------------------------------------------
  mode: 'two-model',

  // ---------------------------------------------------------------------------
  // Models
  //   Only used as written when device.profile is 'custom'; every other
  //   profile replaces vision and text with its own model (src/hardware.js).
  //   The same name for both = single-model mode (the vision model writes the
  //   comment itself). Two different names = two-model mode, e.g.
  //   vision 'qwen2.5vl:7b' + text 'qwen2.5:14b', which needs ~16 GB VRAM to
  //   keep both loaded.
  // ---------------------------------------------------------------------------
  models: {
    // Used for screenshot description in two-model mode,
    // or for the full pipeline in single mode. Must be a vision model.
    vision: 'gemma4:e4b',

    // Used for comment generation in two-model mode.
    // A capable instruction-following text model works best here.
    text: 'gemma4:e4b',

    // Used for generating RAG embeddings.
    // Must be pulled separately: ollama pull nomic-embed-text
    embed: 'nomic-embed-text',
  },

  // ---------------------------------------------------------------------------
  // Ollama
  // ---------------------------------------------------------------------------
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',

    // Context window (tokens). Set by the device profile unless it is 'custom'.
    // Bigger costs VRAM; a screenshot plus Nosey's prompt fits well in 8192.
    numCtx: 8192,

    // Model layers Ollama puts on the GPU. null = let Ollama decide (normal).
    // 0 = run on the processor only, useful when a weak integrated GPU is
    // slower than the CPU or to test the 'cpu' profile.
    numGpu: null,

    // Ask models that can "think" (gemma4, qwen3) to answer directly. Thinking
    // would spend the small token budget below before any comment appears.
    // Models that do not support the option are retried without it.
    disableThinking: true,

    // Max tokens Ollama will generate per call
    commentTokens: 280,
    descriptionTokens: 300,
    summaryTokens: 80,
    answerTokens: 200,

    // Sampling options for comment generation only. Descriptions stay at
    // Ollama defaults -- they must be factual, not creative.
    // Keep temperature at or below 1.0: qwen2.5 starts drifting into Chinese
    // above that, even with an explicit English-only instruction.
    commentOptions: {
      temperature: 1.0,
      top_p: 0.95,
    },
  },

  // ---------------------------------------------------------------------------
  // Ask Nosey
  // ---------------------------------------------------------------------------
  ask: {
    // Seconds the user gets to focus the target window in 'window' capture mode
    countdownSeconds: 5,

    // Default capture target: 'fullscreen' or 'window' (changeable in settings)
    defaultCapture: 'fullscreen',

    // Ask input window size
    windowWidth: 360,
    windowHeight: 120,
  },

  // ---------------------------------------------------------------------------
  // Screen capture
  // ---------------------------------------------------------------------------
  capture: {
    // How often to check for window switches (milliseconds)
    intervalMs: 3000,

    // Minimum pixel change ratio required to trigger an Ollama call.
    // Lower = more sensitive, more frequent comments. Range: 0–1.
    minChangeRatio: 0.02,

    // Resolution used when capturing the active window
    thumbnailWidth: 1280,
    thumbnailHeight: 900,

    // JPEG compression quality (0–100)
    jpegQuality: 75,
  },

  // ---------------------------------------------------------------------------
  // RAG (Retrieval-Augmented Generation)
  // ---------------------------------------------------------------------------
  rag: {
    // How many past comments to fetch from DB for similarity ranking
    retrievalLimit: 5,

    // How many to actually include in the prompt (top-K from retrieval)
    topK: 3,

    // Max character length per retrieved snippet in the context
    snippetLength: 180,

    // How many recent session comments to look back
    recentLimit: 10,

    // Switch from "list last N comments" to "session summary" after this many comments
    sessionInlineThreshold: 5,

    // Max chars of session summary to include in context
    sessionContextLength: 300,

    // Max chars per comment in the inline "recent comments" list
    commentContextLength: 120,

    // Regenerate the rolling session summary every N comments
    summaryEveryN: 5,
  },

  // ---------------------------------------------------------------------------
  // PostgreSQL
  // ---------------------------------------------------------------------------
  db: {
    host: 'localhost',
    port: 5432,
    database: 'nosey',
    user: 'nosey',
    password: 'nosey',
    connectionTimeoutMillis: 3000,

    // Must match the embedding model's output dimension (nomic-embed-text = 768)
    embeddingDimension: 768,

    // IVFFlat index parameter — increase for larger datasets (>10k rows)
    ivfflatLists: 10,
  },

  // ---------------------------------------------------------------------------
  // Telemetry (OpenTelemetry -> Jaeger)
  // ---------------------------------------------------------------------------
  telemetry: {
    otlpUrl: 'http://localhost:4318/v1/traces',
    serviceName: 'nosey',
    exportTimeoutMs: 2000,
  },

  // ---------------------------------------------------------------------------
  // Monitoring dashboard
  // ---------------------------------------------------------------------------
  dashboard: {
    port: 4040,
    jaegerUrl: 'http://localhost:16686',
  },

  // ---------------------------------------------------------------------------
  // Electron window
  // ---------------------------------------------------------------------------
  window: {
    width: 220,
    height: 560,
    // Offset from the bottom-right corner of the work area
    edgeOffsetX: 230,
    edgeOffsetY: 580,
    // How often to re-assert always-on-top to prevent z-order drift
    alwaysOnTopIntervalMs: 1000,
    // How much wider the window grows while a comment bubble is visible.
    // Grows toward whichever side of the screen has room -- see
    // computeExpandedBounds() in main.js.
    bubbleWidthMultiplier: 2,
  },

  // ---------------------------------------------------------------------------
  // UI timing (renderer)
  //   These are read by the renderer via the get-config IPC call.
  // ---------------------------------------------------------------------------
  ui: {
    // Typewriter speed: delay between each character (milliseconds)
    typewriterMs: 22,

    // How long the speech bubble stays visible after the comment finishes
    bubbleHideMs: 10000,

    // How long the startup error bubble stays visible
    startupErrorHideMs: 15000,

    // How long after the last comment before Nosey is considered free to comment again
    processingUnlockMs: 15000,

    // Idle time before Nosey peeks again (milliseconds)
    idlePeekMs: 300000,
  },
}

// Fill in models and context size from the device profile (device.profile above)
require('./hardware').applyProfile(module.exports)
