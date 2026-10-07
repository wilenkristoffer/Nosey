const personaList = document.getElementById('persona-list')
const modeList = document.getElementById('mode-list')
const profileSelect = document.getElementById('profile-select')
const hardwareInfo = document.getElementById('hardware-info')
const intervalSelect = document.getElementById('interval-select')
const activeToggle = document.getElementById('active-toggle')
const askCaptureSelect = document.getElementById('ask-capture-select')

function renderCards(container, items, selectedId, onSelect) {
  container.innerHTML = ''
  items.forEach(({ id, label, description }) => {
    const card = document.createElement('div')
    card.className = 'persona-card' + (id === selectedId ? ' selected' : '')
    card.dataset.id = id
    card.innerHTML = `
      <div class="persona-radio"></div>
      <div class="persona-info">
        <div class="persona-name">${label}</div>
        <div class="persona-desc">${description}</div>
      </div>
    `
    card.addEventListener('click', () => onSelect(id))
    container.appendChild(card)
  })
}

function markSelected(container, id) {
  container.querySelectorAll('.persona-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.id === id)
  })
}

async function init() {
  const [settings, personas, modes] = await Promise.all([
    window.settingsAPI.getSettings(),
    window.settingsAPI.getPersonas(),
    window.settingsAPI.getModes(),
  ])

  renderCards(modeList, modes, settings.mode, selectMode)
  renderCards(personaList, personas, settings.persona, selectPersona)

  // Device profile (options come from the detected hardware)
  const hw = await window.settingsAPI.getHardware()
  profileSelect.innerHTML = ''
  hw.profiles.forEach(({ id, label, model }) => {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = model ? `${label}: ${model}` : label
    profileSelect.appendChild(opt)
  })
  profileSelect.value = settings.profile || 'auto'
  showHardware(hw)

  // Restore interval
  const intervalOpt = intervalSelect.querySelector(`option[value="${settings.interval}"]`)
  if (intervalOpt) intervalSelect.value = settings.interval

  // Restore active
  activeToggle.checked = settings.active

  // Restore ask capture target
  const askOpt = askCaptureSelect.querySelector(`option[value="${settings.askCapture}"]`)
  if (askOpt) askCaptureSelect.value = settings.askCapture
}

function selectPersona(id) {
  markSelected(personaList, id)
  window.settingsAPI.applySettings({ persona: id })
}

function selectMode(id) {
  markSelected(modeList, id)
  window.settingsAPI.applySettings({ mode: id })
}

function showHardware(hw) {
  const missing = hw.missing.length
    ? ` -- not installed, run: ${hw.missing.map((m) => `ollama pull ${m}`).join(', ')}`
    : ''
  hardwareInfo.textContent = `Detected: ${hw.summary}. Using ${hw.model}${missing}`
}

profileSelect.addEventListener('change', async () => {
  window.settingsAPI.applySettings({ profile: profileSelect.value })
  showHardware(await window.settingsAPI.getHardware())
})

intervalSelect.addEventListener('change', () => {
  window.settingsAPI.applySettings({ interval: parseInt(intervalSelect.value) })
})

activeToggle.addEventListener('change', () => {
  window.settingsAPI.applySettings({ active: activeToggle.checked })
})

askCaptureSelect.addEventListener('change', () => {
  window.settingsAPI.applySettings({ askCapture: askCaptureSelect.value })
})

init()
