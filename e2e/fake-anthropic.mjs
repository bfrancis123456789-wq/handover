// Stand-in for the Anthropic Messages API, for local end-to-end tests only.
// Checks the request shape the Edge Function sends and returns a brief built
// from the transcript, so the UI can be exercised without a real API key.
import http from 'node:http'

const port = Number(process.env.PORT || 4010)
export const calls = []

http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.url === '/__calls') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(calls))
    }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
      res.writeHead(404); return res.end()
    }
    const json = JSON.parse(body || '{}')
    calls.push({ headers: Object.keys(req.headers), apiKeyPresent: Boolean(req.headers['x-api-key'] || req.headers.authorization), body: json })
    const text = json.messages?.[0]?.content ?? ''
    const lines = text.split('\n').filter((l) => l.startsWith('['))
    const pick = (re) => lines.filter((l) => re.test(l)).map((l) => l.replace(/^\[[^\]]+\] #\S+( \S+)* \([^)]*\): /, '').slice(0, 120))
    const brief = {
      critical_issues: pick(/broken|leak|fire|injur|complain|short/i),
      ongoing_items: pick(/waiting|ordered|booked|tomorrow|low on|out of/i),
      resolved_today: pick(/fixed|sorted|resolved/i),
      next_priority: pick(/arriv|wedding|delivery|priority/i).slice(0, 3),
    }
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_fake' })
    res.end(JSON.stringify({
      id: 'msg_fake', type: 'message', role: 'assistant', model: json.model,
      content: [{ type: 'text', text: JSON.stringify(brief) }],
      stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: Math.ceil(text.length / 4), output_tokens: 120 },
    }))
  })
}).listen(port, '0.0.0.0', () => console.log('fake anthropic on', port))
