const input = document.getElementById('question')
const sendBtn = document.getElementById('send')

function send() {
  const question = input.value.trim()
  if (!question) return
  window.askAPI.askNosey(question)
}

sendBtn.addEventListener('click', send)

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send()
  if (e.key === 'Escape') window.askAPI.closeAsk()
})

input.focus()
