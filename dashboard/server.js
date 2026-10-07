const http = require('http')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const config = require('../src/config')

const JAEGER = config.dashboard.jaegerUrl
const PORT = config.dashboard.port

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch {
      res.writeHead(500)
      res.end('Could not load dashboard')
    }
    return
  }

  if (req.url.startsWith('/jaeger/')) {
    const jaegerPath = req.url.slice('/jaeger'.length)
    try {
      const upstream = await fetch(JAEGER + jaegerPath)
      const text = await upstream.text()
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' })
      res.end(text)
    } catch {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Cannot reach Jaeger. Is Docker running?' }))
    }
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`
  console.log(`Nosey Monitor: ${url}`)
  exec(`start ${url}`)
})
