// Stand-in for Sentry's ingest endpoint, for local end-to-end tests only.
// Records each event so tests can check what was reported, and what wasn't.
import http from 'node:http'

const port = Number(process.env.PORT || 4030)
let events = []

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.url === '/__events') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(events))
    }
    const m = req.url.match(/^\/api\/(\d+)\/envelope\//)
    if (req.method !== 'POST' || !m) { res.writeHead(404); return res.end() }
    // Envelope: header line, then (item header, item payload) pairs.
    const lines = body.split('\n').filter(Boolean)
    for (let i = 1; i + 1 < lines.length; i += 2) {
      try {
        const head = JSON.parse(lines[i])
        if (head.type === 'event') events.push({ project: m[1], raw: lines[i + 1], event: JSON.parse(lines[i + 1]) })
      } catch { /* ignore non-JSON items */ }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
}).listen(port, '0.0.0.0', () => console.log('fake sentry on', port))
