// Stand-in for a browser push service (like Google's or Apple's), for local
// end-to-end tests only. Records each encrypted push it receives. Endpoints
// whose id starts with "gone-" answer 410, like an expired subscription.
import http from 'node:http'

const port = Number(process.env.PORT || 4020)
let pushes = []

http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    if (req.url === '/__pushes' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(pushes))
    }
    if (req.url === '/__pushes' && req.method === 'DELETE') {
      pushes = []
      res.writeHead(204); return res.end()
    }
    const m = req.url.match(/^\/push\/([\w-]+)$/)
    if (req.method !== 'POST' || !m) { res.writeHead(404); return res.end() }
    if (m[1].startsWith('gone-')) { res.writeHead(410); return res.end() }
    pushes.push({ id: m[1], at: Date.now(), headers: req.headers, body: Buffer.concat(chunks).toString('base64') })
    res.writeHead(201); res.end()
  })
}).listen(port, '0.0.0.0', () => console.log('fake push service on', port))
