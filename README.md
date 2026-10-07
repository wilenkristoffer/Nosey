# Nosey

A desktop companion for Windows that runs entirely on your own computer. Nosey sits in a
corner of the screen as a small animated character. When you switch windows, it takes a
screenshot of the active window, shows it to a local vision model in [Ollama](https://ollama.com),
and makes a short comment in a speech bubble. You can also ask it questions about what is on
screen. Nothing is sent to the cloud.

## Requirements

| | Minimum | Recommended |
|---|---|---|
| Windows | Windows 10 (64-bit) | Windows 11 |
| RAM | 8 GB (GPU profiles) / 16 GB (no GPU) | 16 GB or more |
| Disk | ~1 GB for the app and its dependencies + 5-8 GB for one model | 15 GB free |
| Graphics | none (runs on the processor) | a GPU with 8 GB+ VRAM |
| Software | Ollama 0.30.9 or newer, Node.js 20 or newer | Docker Desktop (optional, see below) |

Nosey picks a **device profile** from the graphics card it finds (see
[Device profiles](#device-profiles)). Each profile uses one model that reads the screenshot
and writes the comment itself:

| Your graphics card | Profile | Model | Download | VRAM in use |
|---|---|---|---|---|
| 12 GB VRAM or more | `desktop` | `gemma4:12b` | 7.6 GB | about 9 GB |
| 8-12 GB VRAM | `laptop` | `gemma4:e4b` | 6.6 GB | about 5.6 GB |
| 4-8 GB VRAM | `small` | `gemma4:e2b` | 4.6 GB | about 3.9 GB |
| no GPU, integrated graphics, or under 4 GB | `cpu` | `gemma4:e4b` on the processor | 6.6 GB | - (uses RAM) |

All profiles also need the small embedding model `nomic-embed-text` (0.3 GB) for comment
memory. Windows itself uses 1-2 GB of the card that drives your display, which is why the
tiers leave headroom.

**Without a GPU** everything still works, only slower: the model runs on the processor and
needs roughly 6-8 GB of free RAM (an estimate, not measured). A comment can take from several seconds to a minute or more,
depending on the processor. Laptops on battery are slower still. Nosey only comments when you
switch windows, so this is usable, but a GPU makes it feel live.

### NVIDIA, AMD and Intel

Nosey does not talk to the graphics card itself. Ollama does that, and picks the right backend
on its own:

- **NVIDIA**: install a current GeForce/Studio driver. Ollama uses CUDA.
- **AMD Radeon**: install a current Adrenalin driver. Ollama uses ROCm on supported cards (or
  Vulkan where available).
- **Intel Arc and other GPUs**: support depends on your Ollama version (Vulkan). If Ollama does
  not use the card, Nosey still works with the `cpu` profile.
- **Integrated graphics** (Intel UHD/Iris, AMD Radeon Graphics in a laptop/APU) share main
  memory and are treated as "no GPU".

To check what Ollama uses, run a model once and then `ollama ps`: the PROCESSOR column shows
GPU or CPU. (The VRAM size Ollama reports for the gemma4 "e" models is too low; use Task
Manager's "Dedicated GPU memory" if you want the real number.)

## Install

1. **Install Ollama** from https://ollama.com/download and start it (it runs in the tray).
2. **Install Node.js** 20 or newer (LTS) from https://nodejs.org.
3. **Get Nosey and its dependencies**:

   ```
   git clone <this repository>
   cd Nosey
   npm install
   ```

4. **Download the model for your profile** (see the table above) and the embedding model. If
   you are not sure, start Nosey first: if the model is missing it tells you which one to pull,
   and Settings shows the detected hardware.

   ```
   ollama pull gemma4:e4b
   ollama pull nomic-embed-text
   ```

5. **Optional: Docker Desktop.** With Docker running, `npm start` also starts PostgreSQL with
   pgvector (comment history, the Sessions window, the daily recap and "don't repeat yourself"
   memory) and Jaeger (tracing for `npm run monitor`). Without Docker, Nosey runs fine but forgets
   everything when it closes.
6. **Start Nosey**:

   ```
   npm start
   ```

## Using Nosey

- Nosey comments when you switch to another window.
- **Right-click** the character for the menu: Ask Nosey, Pause/Resume, Daily Recap, Sessions,
  Settings, Quit.
- **Ctrl+Shift+N** opens Ask Nosey from anywhere.
- **Drag** the character to move it.
- **Settings** let you pick the mode (Commentary, Coach, Quest Narrator, Focus Keeper), the
  personality, the device profile, how often to check for window switches, and what Ask Nosey
  captures (full screen or one window).

## Device profiles

`device.profile` in `src/config.js` (and **Device Profile** in Settings, which is remembered
per user) decides which model Nosey uses:

| Value | Meaning |
|---|---|
| `auto` (default) | Detect the graphics card and pick `desktop`, `laptop`, `small` or `cpu` |
| `desktop`, `laptop`, `small`, `cpu` | Use that profile regardless of the hardware |
| `custom` | Use `models.vision`, `models.text` and `ollama.numCtx` in `src/config.js` as written |

Detection reads the display adapters and their dedicated memory from the Windows registry,
ignores virtual and remote-desktop adapters, treats integrated graphics as "no GPU", and uses
the discrete card with the most VRAM. The result is printed at startup (`[device] ...`) and
shown in Settings.

Other settings in `src/config.js` under `ollama`:

- `numCtx`: the context size (default 8192 tokens, set by the profile).
- `numGpu`: `null` lets Ollama decide. `0` forces the processor, which helps when a weak
  integrated GPU is slower than the CPU.
- `disableThinking`: asks thinking models to answer directly (on by default).

With `custom` you can use any vision model in Ollama. Use the same name for `vision` and `text`
for one model, or two different names to have a vision model describe the screen and a text
model write the comment. That needs both models in VRAM at once, e.g. `qwen2.5vl:7b` +
`qwen2.5:14b` needs about 16 GB.

### How the profiles were chosen

VRAM figures are measured while generating, with Windows' "Dedicated GPU memory" counter and a
16k context (Nosey uses 8k, so it needs the same or less). On a 16 GB desktop GPU, on a long
text task: `gemma4:12b` 50 tokens/s, `gemma4:e4b` 105 tokens/s, `gemma4:e2b` 122 tokens/s. On a
6-core desktop processor only: `gemma4:e4b` 11.5 tokens/s, `gemma4:e2b` 21 tokens/s. `gemma4:12b`
gives the best text; `e4b` is good but wordier; `e2b` gets the main points with more mistakes.
For the `cpu` profile, `e4b` was chosen over `e2b` for quality despite being slower.
`gemma3:4b` was tried and ruled out: it invented details that were not in its input.

These numbers come from a text task, not from Nosey's screenshots. How well each model reads
screens, and how fast a comment appears with an image, has not been measured yet.

## Privacy

Everything runs on your computer. Nosey only talks to Ollama, PostgreSQL and Jaeger on
`localhost`. Still, it handles what is on your screen, so it is worth knowing where things end up:

| What | Where | Contents |
|---|---|---|
| Screenshots | memory only (by default) | Sent to Ollama, not saved |
| Debug files (`debug: true` in `src/config.js`, off by default) | `%APPDATA%\Nosey\debug` | Screenshots, descriptions, comments |
| Comment history | PostgreSQL in Docker (volume `nosey_pgdata`) | Window titles, screen descriptions, comments, your Ask Nosey questions |
| Traces | Jaeger in Docker (in memory) | Window titles and comment text |
| Settings | `%APPDATA%\Nosey\settings.json` | Your choices in Settings |

To delete the history: `docker compose down -v` (removes the database volume). DRM-protected
video (Netflix and similar) shows up as black in screenshots; that is Windows, not Nosey.

## Development

| Command | What it does |
|---|---|
| `npm start` | Run the app (starts the Docker services first if Docker is available) |
| `npm test` | Unit tests (vitest) |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run monitor` | Local dashboard over the Jaeger traces (http://localhost:4040) |
| `npm run package` / `npm run make` | Build the app / a Windows installer (needs `assets/icon.ico`) |

Code layout: `src/main.js` (Electron main process: capture, Ollama pipeline, IPC),
`src/ollama-client.js` (prompts and Ollama calls), `src/hardware.js` (device profiles),
`src/config.js` (all settings), `src/db.js` + `src/rag.js` (history and memory),
`src/renderer/` (character, speech bubble, Settings, Sessions and Ask windows).

## License

MIT, see [LICENSE](LICENSE).
