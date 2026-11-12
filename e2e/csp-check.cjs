// Serves the production build with the real Cloudflare headers (public/_headers)
// and clicks through the app as the demo manager, failing on anything the
// Content-Security-Policy blocks. Run after the demo has been reset.
const { chromium } = require('playwright')
const { execSync, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const PORT = 4173
const BASE = `http://localhost:${PORT}`

// Parse the "/*" block of public/_headers.
function headersFor(block) {
  const lines = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8').split('\n')
  const out = {}
  let inBlock = false
  for (const line of lines) {
    if (/^\S/.test(line)) inBlock = line.trim() === block
    else if (inBlock && line.includes(':')) {
      const i = line.indexOf(':')
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
  }
  return out
}

;(async () => {
  const headers = headersFor('/*')
  if (!headers['Content-Security-Policy']) throw new Error('No CSP found in public/_headers')
  fs.writeFileSync(path.join(root, 'e2e/.preview-headers.json'), JSON.stringify(headers))

  // The app talks to its own origin (proxied to the local stack), as 'self'.
  const anon = execSync('supabase status -o env', { encoding: 'utf8' }).match(/^ANON_KEY="?([^"\n]+)/m)[1]
  execSync('npx vite build --outDir e2e/.csp-dist --emptyOutDir', {
    cwd: root, stdio: 'ignore',
    env: { ...process.env, VITE_SUPABASE_URL: BASE, VITE_SUPABASE_ANON_KEY: anon, VITE_SENTRY_DSN: '', VITE_VAPID_PUBLIC_KEY: 'BIh88-8gWG3xzfL1spmtpEcdVS8oe4h0RI1nyqqxo4mPefdjhWocu4aJ-TYjURKy3ytuKTL-xzQTfV4dlrZhsxM' },
  })
  const server = spawn('npx', ['vite', 'preview', '--config', 'e2e/vite.preview.config.js', '--port', String(PORT), '--strictPort', '--outDir', 'e2e/.csp-dist'], { cwd: root, stdio: 'ignore' })
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE); break } catch { await new Promise((r) => setTimeout(r, 500)) } }

    const res = await fetch(`${BASE}/channels/general`)
    const deepLinkOk = res.ok && (await res.text()).includes('<div id="root">')
    const cspApplied = (res.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'")

    const browser = await chromium.launch()
    const page = await browser.newPage()
    const violations = []
    page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()) })
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window.__csp = window.__csp || []).push(`${e.violatedDirective}: ${e.blockedURI}`)
      })
    })
    await page.goto(`${BASE}/login`)
    await page.fill('#login-email', 'demo.manager@demo.handover.test')
    await page.fill('#login-password', process.env.DEMO_PASSWORD || 'HandoverDemo-2026')
    await page.click('button:has-text("Sign in")')
    await page.waitForSelector('[data-testid="critical"] li', { timeout: 15000 })
    for (const p of ['/channels/general', '/settings/profile', '/settings/notifications', '/settings/account', '/settings/team', '/privacy']) {
      await page.goto(BASE + p)
      await page.waitForLoadState('networkidle')
      violations.push(...(await page.evaluate(() => window.__csp || [])))
    }
    await browser.close()

    const ok = violations.length === 0 && deepLinkOk && cspApplied
    console.log(`${deepLinkOk ? 'PASS' : 'FAIL'}  deep links serve the app`)
    console.log(`${cspApplied ? 'PASS' : 'FAIL'}  the production Content-Security-Policy is applied`)
    console.log(`${violations.length === 0 ? 'PASS' : 'FAIL'}  production headers block nothing the app needs`)
    if (violations.length) console.log(violations.slice(0, 10).join('\n'))
    process.exitCode = ok ? 0 : 1
  } finally {
    server.kill()
  }
})().catch((e) => { console.error(e); process.exit(1) })
