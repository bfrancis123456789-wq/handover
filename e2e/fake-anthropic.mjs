// Stand-in for the Anthropic Messages API, for local end-to-end tests only.
// Records each request and answers the shift-brief prompt with simple,
// predictable rules, so the app can be tested without a real API key:
//   - a message with a problem word (broken, leak, short...) becomes a new issue
//   - "fixed"/"sorted"/"resolved" plus a word from an open issue's title resolves it
//   - every other open issue stays open
import http from 'node:http'

const port = Number(process.env.PORT || 4010)
const calls = []
let failRemaining = 0 // set by POST /__fail_next to simulate an outage (covers the SDK's retries)

const CRITICAL = /broken|leak|fire|smoke|injur|complain|short|unsafe|spill/i
const NORMAL = /waiting|ordered|booked|tomorrow|low on|out of|needs/i
const FIXED = /\b(fixed|sorted|resolved|repaired|working again)\b/i
const PRIORITY = /arriv|wedding|delivery|priority/i
const STOP = new Set(['with', 'from', 'this', 'that', 'have', 'been', 'into', 'there', 'their', 'again', 'the', 'and', 'won\'t', 'isn\'t'])

const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)))
const overlap = (a, b) => [...a].filter((w) => b.has(w)).length

function brief(prompt) {
  const issues = [...prompt.matchAll(/^(I\d+) \| (\w+) \| [^|]+\| [^|]+\| [^|]+\| (.*)$/gm)].map((m) => ({ label: m[1], title: m[3], words: words(m[3]) }))
  const messages = [...prompt.matchAll(/^(M\d+) \| [^|]+\| [^|]+\| [^:]+: (.*)$/gm)].map((m) => ({ label: m[1], text: m[2], words: words(m[2]) }))

  const resolved = []
  const used = new Set()
  for (const iss of issues) {
    const fix = messages.find((m) => FIXED.test(m.text) && overlap(m.words, iss.words) >= 1)
    if (fix) { resolved.push({ issue: iss.label, source_messages: [fix.label] }); used.add(fix.label) }
  }
  const newIssues = []
  for (const m of messages) {
    if (used.has(m.label)) continue
    if (issues.some((iss) => overlap(m.words, iss.words) >= 2)) continue // already tracked
    const critical = CRITICAL.test(m.text)
    if (!critical && !NORMAL.test(m.text)) continue
    newIssues.push({ title: m.text.slice(0, 120), severity: critical ? 'critical' : 'normal', source_messages: [m.label], already_resolved: FIXED.test(m.text) })
  }
  return {
    new_issues: newIssues,
    resolved_issues: resolved,
    still_open_issues: issues.filter((i) => !resolved.some((r) => r.issue === i.label)).map((i) => i.label),
    next_priority: messages.filter((m) => PRIORITY.test(m.text)).map((m) => m.text.slice(0, 120)).slice(0, 3),
  }
}

http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.url === '/__calls') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(calls))
    }
    if (req.url === '/__fail_next') {
      failRemaining = 3
      res.writeHead(204); return res.end()
    }
    if (failRemaining > 0 && req.url.startsWith('/v1/messages')) {
      failRemaining--
      res.writeHead(500, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Simulated outage' } }))
    }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
      res.writeHead(404); return res.end()
    }
    const json = JSON.parse(body || '{}')
    calls.push({ headers: Object.keys(req.headers), apiKeyPresent: Boolean(req.headers['x-api-key'] || req.headers.authorization), body: json })
    const prompt = json.messages?.[0]?.content ?? ''
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_fake' })
    res.end(JSON.stringify({
      id: 'msg_fake', type: 'message', role: 'assistant', model: json.model,
      content: [{ type: 'text', text: JSON.stringify(brief(prompt)) }],
      stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: Math.ceil(prompt.length / 4), output_tokens: 120 },
    }))
  })
}).listen(port, '0.0.0.0', () => console.log('fake anthropic on', port))
