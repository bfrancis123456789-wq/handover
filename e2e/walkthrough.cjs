// End-to-end walkthrough of Handover against a local Supabase stack.
// Several people use the app at once in separate browser contexts.
// Run: node e2e/walkthrough.cjs   (needs the local stack, fake Claude API and e2e dev server)
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const FAKE_AI = process.env.FAKE_AI || 'http://127.0.0.1:4010'
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })

const { execSync } = require('child_process')
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const sql = (q) => execSync(`docker exec -i supabase_db_handover psql -U postgres -tA`, { input: q }).toString().trim()
const run = Date.now().toString(36)
const email = (n) => `${n}.${run}@example.com`
const { decrypt } = require('./webpush-decrypt.cjs')
const FAKE_PUSH = process.env.FAKE_PUSH || 'http://127.0.0.1:4020'
const FAKE_SENTRY = process.env.FAKE_SENTRY || 'http://127.0.0.1:4030'
// Vault settings that point the database trigger at the local send-push function.
const PUSH_FUNCTION_URL = process.env.PUSH_FUNCTION_URL || 'http://172.18.0.1:8001'

// Browsers here cannot reach real push services, so each test browser gets a
// stand-in subscription with real encryption keys, pointed at the fake push service.
const PUSH_STUB = `(() => {
  if (!('PushManager' in window)) return;
  const host = ${JSON.stringify(FAKE_PUSH)};
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer;
  const wrap = (d) => ({
    endpoint: d.endpoint, expirationTime: null,
    getKey: (n) => unb64(n === 'p256dh' ? d.pub : d.auth),
    toJSON: () => ({ endpoint: d.endpoint, expirationTime: null, keys: { p256dh: d.pub, auth: d.auth } }),
    unsubscribe: async () => { localStorage.removeItem('__fakePush'); return true; },
  });
  const load = () => { try { return JSON.parse(localStorage.getItem('__fakePush')); } catch { return null; } };
  // Headless Chrome always reports "denied"; act like a person who taps Allow on the prompt.
  Object.defineProperty(Notification, 'permission', { configurable: true, get: () => localStorage.getItem('__fakePerm') || 'default' });
  Notification.requestPermission = async () => { localStorage.setItem('__fakePerm', 'granted'); return 'granted'; };
  PushManager.prototype.getSubscription = async function () { const d = load(); return d ? wrap(d) : null; };
  PushManager.prototype.subscribe = async function () {
    const existing = load(); if (existing) return wrap(existing);
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const d = {
      endpoint: host + '/push/' + crypto.randomUUID(),
      pub: b64(await crypto.subtle.exportKey('raw', kp.publicKey)),
      auth: b64(crypto.getRandomValues(new Uint8Array(16))),
      jwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
    };
    localStorage.setItem('__fakePush', JSON.stringify(d));
    return wrap(d);
  };
})();`

async function pushesFor(page) {
  const sub = await page.evaluate(() => JSON.parse(localStorage.getItem('__fakePush') || 'null'))
  if (!sub) return []
  const id = sub.endpoint.split('/').pop()
  const all = await fetch(`${FAKE_PUSH}/__pushes`).then((r) => r.json())
  return all.filter((p) => p.id === id).map((p) => ({ ...p, payload: decrypt(p.body, sub) }))
}

// Authenticator-app codes (RFC 6238), so the test can sign in with two-factor.
function totp(secretBase32, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secretBase32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = require('crypto').createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0')
}

const results = []
const errors = []

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -> ${detail}` : ''}`)
}

const allUsers = []
async function step(name, fn) {
  try { await fn() } catch (e) {
    check(name, false, e.message.split('\n')[0])
    // Save every user's screen to help work out what went wrong.
    for (const u of allUsers) {
      await u.page.screenshot({ path: path.join(OUT, `fail-${name.replace(/\W+/g, '-')}-${u.label}.png`) }).catch(() => {})
    }
  }
}

async function newUser(browser, label, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true })
  await ctx.grantPermissions(['notifications'])
  await ctx.addInitScript(PUSH_STUB)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|WebSocket|status of 4\d\d/.test(m.text())) errors.push(`${label}: ${m.text()}`)
  })
  const user = { ctx, page, label }
  allUsers.push(user)
  return user
}

async function signup(page, name, mail, password = 'password123') {
  await page.goto(`${BASE}/signup`)
  await page.fill('#signup-name', name)
  await page.fill('#signup-email', mail)
  await page.fill('#signup-password', password)
  await page.check('#signup-terms')
  await page.click('button:has-text("Create account")')
  await page.waitForSelector('text=let\'s get you set up', { timeout: 10000 })
}

async function aiCalls() {
  const r = await fetch(`${FAKE_AI}/__calls`)
  return r.json()
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
}

async function makePng(browser, file, color, label) {
  const p = await browser.newPage({ viewport: { width: 480, height: 320 } })
  await p.setContent(`<div style="width:480px;height:320px;background:${color};display:flex;align-items:center;justify-content:center;font:bold 40px sans-serif;color:#fff">${label}</div>`)
  await p.screenshot({ path: file })
  await p.close()
}

;(async () => {
  const browser = await chromium.launch()
  const photo = path.join(OUT, 'photo.png')
  const avatarFile = path.join(OUT, 'avatar.png')
  await makePng(browser, photo, '#c0392b', 'Leak under bar 1')
  await makePng(browser, avatarFile, '#2a3d63', 'SS')

  const mgr = await newUser(browser, 'manager')
  const staff = await newUser(browser, 'staff')
  const lead = await newUser(browser, 'lead')
  const outsider = await newUser(browser, 'outsider')
  let joinCode = ''

  // 1. Manager signs up and creates a workplace
  await step('manager onboarding', async () => {
    await mgr.page.goto(BASE)
    await mgr.page.waitForURL('**/login', { timeout: 8000 }).catch(() => {})
    check('signed-out visitor is sent to sign in', mgr.page.url().endsWith('/login'))
    await mgr.page.goto(`${BASE}/signup`)
    await mgr.page.fill('#signup-name', 'Mia Manager')
    await mgr.page.fill('#signup-email', email('mia'))
    await mgr.page.fill('#signup-password', 'short')
    await mgr.page.click('button:has-text("Create account")')
    check('short password is rejected with a message', await mgr.page.isVisible('text=at least 8 characters'))
    await mgr.page.fill('#signup-password', 'password123')
    await mgr.page.click('button:has-text("Create account")')
    check('signup asks people to agree to the Terms and Privacy Policy', await mgr.page.isVisible('text=Tick the box to agree'))
    await mgr.page.check('#signup-terms')
    await mgr.page.click('button:has-text("Create account")')
    await mgr.page.waitForSelector('text=Hi Mia, let\'s get you set up')
    check('agreeing records the terms version', /^\d{4}-\d{2}-\d{2}$/.test(sql(`select raw_user_meta_data->>'terms_version' from auth.users where email = '${email('mia')}';`)))
    check('signup leads to workplace setup with first name', true)
    await mgr.page.click('role=tab[name="Create a workplace"]')
    await mgr.page.fill('#workplace-name', 'Harbour Hotel')
    await mgr.page.click('button:has-text("Create workplace")')
    await mgr.page.waitForSelector('text=Your workplace is ready')
    check('manager sees the manager welcome dialog', true)
    await mgr.page.click('button:has-text("Get Started")')
    await mgr.page.waitForSelector('text=Your Shift Brief')
    await mgr.page.reload()
    await mgr.page.waitForSelector('text=Your Shift Brief')
    check('welcome dialog shows only once', !(await mgr.page.isVisible('text=Your workplace is ready')))
    const h = new Date().getHours()
    const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
    check('greeting matches time of day', await mgr.page.isVisible(`text=${greet}, Mia`))
    check('manager sidebar shows Management and Manage Team',
      (await mgr.page.isVisible('nav >> text=Management')) && (await mgr.page.isVisible('nav >> text=Manage Team')))
  })

  // 2. Empty brief does not call the AI
  await step('empty brief', async () => {
    const before = (await aiCalls()).length
    await mgr.page.click('button:has-text("Refresh Summary")')
    await mgr.page.waitForSelector('text=No messages in the last 24 hours')
    check('empty workplace shows friendly message', true)
    check('no AI call when there are no messages', (await aiCalls()).length === before)
  })

  // 3. Join code
  await step('join code', async () => {
    await mgr.page.click('nav >> text=Manage Team')
    await mgr.page.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.querySelector('.select-all')?.textContent.trim() || ''))
    joinCode = (await mgr.page.textContent('.select-all')).trim()
    check('join code is 6 letters/digits', /^[A-Z0-9]{6}$/.test(joinCode), joinCode)
  })

  // 4. Staff joins
  await step('staff joins', async () => {
    await signup(staff.page, 'Sid Staff', email('sid'))
    await staff.page.fill('#join-code', 'ZZZZZ9')
    await staff.page.click('button:has-text("Join workplace")')
    await staff.page.waitForSelector('text=does not match any workplace')
    check('wrong join code shows a clear error', true)
    await staff.page.fill('#join-code', joinCode.toLowerCase())
    await staff.page.click('button:has-text("Join workplace")')
    await staff.page.waitForSelector('text=Welcome to the team')
    check('lowercase code works and shows team member welcome', await staff.page.isVisible('text=Read Announcements'))
    await staff.page.click('button:has-text("Get Started")')
    const nav = await staff.page.textContent('nav')
    check('team member cannot see Supervisors, Management or Manage Team',
      !nav.includes('Supervisors') && !nav.includes('Management') && !nav.includes('Manage Team'), nav)
    await staff.page.goto(`${BASE}/channels/management`)
    await staff.page.waitForSelector('text=Your Shift Brief')
    check('typing the Management URL sends team member home', !staff.page.url().includes('management'))
    await staff.page.goto(`${BASE}/settings/team`)
    await staff.page.waitForSelector('text=Your Shift Brief')
    check('typing the Manage Team URL sends team member home', !staff.page.url().includes('team'))
  })

  // 5. Live chat between two people
  await step('live chat', async () => {
    await staff.page.click('nav >> text=Announcements')
    await staff.page.waitForSelector('main h1:text-is("Announcements")')
    await staff.page.waitForSelector('text=No messages in Announcements yet', { timeout: 8000 }).catch(() => {})
    check('empty channel shows friendly empty state', await staff.page.isVisible('text=No messages in Announcements yet'))
    check('team member cannot post in Announcements and is told why',
      (await staff.page.isVisible('text=Only managers and supervisors can post in Announcements')) && !(await staff.page.isVisible('#chat-text')))
    await mgr.page.click('nav >> text=General')
    await mgr.page.waitForSelector('main h1:text-is("General")')
    await staff.page.click('nav >> text=General')
    await staff.page.waitForSelector('main h1:text-is("General")')
    await staff.page.fill('#chat-text', 'Fridge 3 is broken and leaking water')
    await staff.page.click('button:has-text("Post")')
    await staff.page.waitForSelector('article:has-text("Fridge 3 is broken")')
    check('post box clears after posting', (await staff.page.inputValue('#chat-text')) === '')
    await mgr.page.waitForSelector('article:has-text("Fridge 3 is broken")', { timeout: 8000 })
    check('manager sees the new message live without refreshing', true)
    const card = mgr.page.locator('article', { hasText: 'Fridge 3 is broken' })
    await staff.page.fill('#chat-text', 'Half-typed draft for General')
    await staff.page.click('nav >> text=Team Member')
    await staff.page.waitForSelector('main h1:text-is("Team Member")')
    check('a draft does not follow you into another channel', (await staff.page.inputValue('#chat-text')) === '')
    await staff.page.click('nav >> text=General')
    await staff.page.waitForSelector('main h1:text-is("General")')
    check('message shows author name and Team Member badge',
      (await card.textContent()).includes('Sid Staff') && (await card.textContent()).includes('Team Member'))
  })

  // 6. Likes
  await step('likes', async () => {
    const mcard = mgr.page.locator('article', { hasText: 'Fridge 3 is broken' })
    await mcard.locator('button[aria-label="Like"]').click()
    const scard = staff.page.locator('article', { hasText: 'Fridge 3 is broken' })
    await scard.locator('button[aria-pressed] >> text=1').waitFor({ timeout: 8000 })
    check('like count updates live for the author', true)
    await mcard.locator('button[aria-label="Unlike"]').click()
    await scard.locator('button[aria-pressed] >> text=Like').waitFor({ timeout: 8000 })
    check('unlike updates live', true)
    await mcard.locator('button[aria-label="Like"]').click()
    await mgr.page.reload()
    await mgr.page.locator('article', { hasText: 'Fridge 3 is broken' }).locator('button[aria-label="Unlike"]').waitFor()
    check('like is saved after reload', true)
  })

  // 7. Photos
  await step('photos', async () => {
    await staff.page.setInputFiles('#chat-image', photo)
    await staff.page.waitForSelector('img[alt="Attachment preview"]')
    check('attached photo shows a preview', true)
    await staff.page.click('button[aria-label="Remove photo"]')
    check('preview can be removed', !(await staff.page.isVisible('img[alt="Attachment preview"]')))
    await staff.page.setInputFiles('#chat-image', photo)
    await staff.page.fill('#chat-text', 'Photo of the leak')
    await staff.page.click('button:has-text("Post")')
    await staff.page.waitForSelector('article:has-text("Photo of the leak") img[loading="lazy"]', { timeout: 10000 })
    check('photo posts with message', !(await staff.page.isVisible('img[alt="Attachment preview"]')))
    await mgr.page.waitForSelector('article:has-text("Photo of the leak") img[loading="lazy"]', { timeout: 10000 })
    check('photo appears live for others', true)
    await mgr.page.click('article:has-text("Photo of the leak") button[aria-label="Open photo full screen"]')
    await mgr.page.waitForSelector('role=dialog[name="Photo"]')
    check('tapping a photo opens it full screen', true)
    const [download] = await Promise.all([
      mgr.page.waitForEvent('download', { timeout: 8000 }),
      mgr.page.click('role=dialog >> button:has-text("Save")'),
    ])
    check('Save downloads the photo', !!download.suggestedFilename(), download.suggestedFilename())
    await mgr.page.click('role=dialog >> button:has-text("Close")')
    check('Close leaves full screen', !(await mgr.page.isVisible('role=dialog[name="Photo"]')))
  })

  // 8. Brief respects channel access
  await step('brief access', async () => {
    await mgr.page.click('nav >> text=Management')
    await mgr.page.waitForSelector('main h1:text-is("Management")')
    await mgr.page.fill('#chat-text', 'Till 2 was 20 pounds short on Friday')
    await mgr.page.click('button:has-text("Post")')
    await mgr.page.waitForSelector('article:has-text("Till 2")')
    await staff.page.click('nav >> text=Home')
    await staff.page.click('button:has-text("Refresh Summary")')
    await staff.page.waitForSelector('li:has-text("Fridge 3")', { timeout: 15000 })
    let calls = await aiCalls()
    const staffReq = calls[calls.length - 1].body
    const staffText = staffReq.messages[0].content
    check('brief request uses a Haiku model and JSON schema output',
      /haiku/.test(staffReq.model) && staffReq.output_config?.format?.type === 'json_schema', staffReq.model)
    check('team member brief excludes Management messages', !staffText.includes('Till 2') && staffText.includes('Fridge 3'))
    check('brief shows the critical issue', await staff.page.isVisible('li:has-text("Fridge 3")'))
    await mgr.page.click('nav >> text=Home')
    await mgr.page.click('button:has-text("Refresh Summary")')
    await mgr.page.waitForFunction(() => document.body.innerText.includes('Till 2'), null, { timeout: 10000 })
    calls = await aiCalls()
    check('manager brief includes Management messages', calls[calls.length - 1].body.messages[0].content.includes('Till 2'))
    await staff.page.reload()
    await staff.page.waitForSelector('li:has-text("Fridge 3")')
    check('saved brief appears on reload', true)
  })

  // 9. Role change takes effect live
  await step('role change', async () => {
    await mgr.page.click('nav >> text=Manage Team')
    await mgr.page.waitForSelector('text=Team members')
    const row = mgr.page.locator('li', { hasText: 'Sid Staff' })
    await row.locator('select[id^="role-"]').selectOption('supervisor')
    await mgr.page.waitForSelector('text=Sid Staff is now a Supervisor')
    await staff.page.waitForSelector('nav >> text=Supervisors', { timeout: 8000 })
    check('promoted user sees Supervisors channel without reloading', true)
    const own = mgr.page.locator('li', { hasText: '(you)' })
    await own.locator('select[id^="role-"]').selectOption('team_member')
    await mgr.page.waitForSelector('text=at least one manager')
    check('last manager cannot demote themselves', true)
  })

  // 10. Profile
  await step('profile', async () => {
    await staff.page.click('nav >> text=My Profile')
    await staff.page.fill('#profile-name', 'Sid Sparks')
    await staff.page.click('button:has-text("Save changes")')
    await staff.page.waitForSelector('text=Display name saved')
    check('display name updates in the sidebar', (await staff.page.textContent('aside, .flex.h-full')).includes('Sid Sparks'))
    await staff.page.setInputFiles('#avatar-file', avatarFile)
    await staff.page.waitForSelector('text=Profile photo updated', { timeout: 10000 })
    check('profile photo uploads', await staff.page.isVisible('img[src*="/storage/v1/object/public/avatars/"]'))
    check('profile shows role badge and workplace', (await staff.page.textContent('main')).includes('Harbour Hotel'))
  })

  // 11. Notifications persist
  await step('notifications', async () => {
    await staff.page.click('nav >> text=Notifications')
    await staff.page.click('#notify-general')
    await staff.page.waitForTimeout(500)
    await staff.page.reload()
    await staff.page.waitForSelector('#notify-general')
    check('notification setting is saved', (await staff.page.getAttribute('#notify-general', 'aria-checked')) === 'false')
  })

  // 12. Password change
  await step('password', async () => {
    await staff.page.click('nav >> text=Account')
    await staff.page.fill('#new-password', 'newpassword456')
    await staff.page.fill('#confirm-password', 'newpassword456')
    await staff.page.click('button:has-text("Update password")')
    await staff.page.waitForSelector('text=Password updated')
    await staff.page.click('button[aria-label="Sign out"]')
    await staff.page.waitForSelector('#login-email')
    await staff.page.fill('#login-email', email('sid'))
    await staff.page.fill('#login-password', 'newpassword456')
    await staff.page.click('button:has-text("Sign in")')
    await staff.page.waitForSelector('text=Your Shift Brief')
    check('new password works after signing out', true)
  })

  // 13. Leaving
  await step('leave workplace', async () => {
    await mgr.page.click('nav >> text=Account')
    await mgr.page.click('button:has-text("Leave Workplace")')
    await mgr.page.click('button:has-text("Yes, leave workplace")')
    await mgr.page.waitForSelector('text=only manager')
    check('only manager cannot leave', true)
    await staff.page.click('nav >> text=Account')
    await staff.page.click('button:has-text("Leave Workplace")')
    await staff.page.click('button:has-text("Yes, leave workplace")')
    await staff.page.waitForSelector('text=let\'s get you set up')
    check('leaving returns to workplace setup', true)
    await staff.page.fill('#join-code', joinCode)
    await staff.page.click('button:has-text("Join workplace")')
    await staff.page.waitForSelector('text=Welcome to the team')
    check('can rejoin and sees welcome again', true)
    await staff.page.click('button:has-text("Get Started")')
  })

  // 14. Another workplace sees nothing
  await step('isolation', async () => {
    await signup(outsider.page, 'Oli Outsider', email('oli'))
    await outsider.page.click('role=tab[name="Create a workplace"]')
    await outsider.page.fill('#workplace-name', 'Other Cafe')
    await outsider.page.click('button:has-text("Create workplace")')
    await outsider.page.click('button:has-text("Get Started")')
    await outsider.page.click('nav >> text=General')
    await outsider.page.waitForSelector('main h1:text-is("General")')
    await outsider.page.waitForSelector('text=No messages in General yet')
    check('another workplace cannot see Harbour Hotel messages', true)
  })

  // 15. Phone layout
  await step('phone layout', async () => {
    await signup(lead.page, 'Lee Lead', email('lee'))
    await lead.page.setViewportSize({ width: 390, height: 844 })
    await lead.page.fill('#join-code', joinCode)
    await lead.page.click('button:has-text("Join workplace")')
    await lead.page.click('button:has-text("Get Started")')
    check('sidebar is hidden behind a menu button on phones', await lead.page.isVisible('button[aria-label="Open menu"]'))
    const pages = ['Home', 'General', 'My Profile', 'Notifications', 'Account', 'Help & Support']
    const wide = []
    for (const name of pages) {
      await lead.page.click('button[aria-label="Open menu"]')
      await lead.page.click(`.fixed nav >> text="${name}"`)
      await lead.page.waitForTimeout(300)
      if (!(await noHorizontalScroll(lead.page))) wide.push(name)
    }
    check('no sideways scrolling on any page at phone width', wide.length === 0, wide.join(', '))
    await lead.page.click('button[aria-label="Open menu"]')
    await lead.page.click('.fixed nav >> text="General"')
    await lead.page.waitForSelector('article')
    await lead.page.screenshot({ path: path.join(OUT, 'phone-chat.png') })
  })


  // 16. Unread counts
  await step('unread counts', async () => {
    await staff.page.click('nav >> text=Home')
    await mgr.page.click('nav >> text=Announcements')
    await mgr.page.waitForSelector('main h1:text-is("Announcements")')
    await mgr.page.fill('#chat-text', 'Rota for next week is up')
    await mgr.page.click('button:has-text("Post")')
    await staff.page.waitForSelector('nav a:has-text("Announcements") [aria-label="1 unread"]', { timeout: 8000 })
    check('unread badge appears live in the sidebar', true)
    check('Home channel card shows new count', await staff.page.isVisible('text=1 new'))
    check('browser tab shows unread total', (await staff.page.title()).startsWith('(1)'), await staff.page.title())
    await staff.page.click('nav >> text=Announcements')
    await staff.page.waitForSelector('main h1:text-is("Announcements")')
    await staff.page.waitForSelector('article:has-text("Rota for next week")')
    check('opening the channel clears its badge', !(await staff.page.isVisible('nav a:has-text("Announcements") [aria-label$="unread"]')))
    await staff.page.reload()
    await staff.page.waitForSelector('article:has-text("Rota for next week")')
    await staff.page.waitForTimeout(800)
    check('read state is saved after reload', !(await staff.page.isVisible('nav a:has-text("Announcements") [aria-label$="unread"]')))
  })

  // 17. Deleting messages
  await step('delete messages', async () => {
    await staff.page.click('nav >> text=General')
    await staff.page.waitForSelector('main h1:text-is("General")')
    await mgr.page.click('nav >> text=General')
    await mgr.page.waitForSelector('main h1:text-is("General")')
    await staff.page.fill('#chat-text', 'Oops wrong channel')
    await staff.page.click('button:has-text("Post")')
    await mgr.page.waitForSelector('article:has-text("Oops wrong channel")', { timeout: 8000 })
    const own = staff.page.locator('article', { hasText: 'Oops wrong channel' })
    await own.hover()
    await own.locator('button[aria-label="Delete message"]').click()
    await own.locator('button:has-text("Delete")').last().click()
    await staff.page.waitForSelector('article:has-text("Oops wrong channel")', { state: 'detached', timeout: 8000 })
    check('author can delete their own message', true)
    await mgr.page.waitForSelector('article:has-text("Oops wrong channel")', { state: 'detached', timeout: 8000 })
    check('deleted message disappears for others live', true)
    await mgr.page.fill('#chat-text', 'Manager note in general')
    await mgr.page.click('button:has-text("Post")')
    await staff.page.waitForSelector('article:has-text("Manager note in general")', { timeout: 8000 })
    check('team member gets no delete button on others\' messages',
      (await staff.page.locator('article', { hasText: 'Manager note in general' }).locator('button[aria-label="Delete message"]').count()) === 0)
    const other = mgr.page.locator('article', { hasText: 'Photo of the leak' })
    await other.hover()
    await other.locator('button[aria-label="Delete message"]').click()
    await other.locator('button:has-text("Delete")').last().click()
    await staff.page.waitForSelector('article:has-text("Photo of the leak")', { state: 'detached', timeout: 8000 })
    check('manager can delete anyone\'s message', true)
  })

  // 18. Brief reuse and cooldown
  await step('brief reuse', async () => {
    sql(`update summaries set created_at = now() - interval '5 minutes' where user_id = (select id from auth.users where email = '${email('sid')}');`)
    await staff.page.click('nav >> text=Home')
    let before = (await aiCalls()).length
    await staff.page.click('button:has-text("Refresh Summary")')
    await staff.page.waitForFunction((n) => !document.body.innerText.includes('Summarising'), null, { timeout: 15000 })
    await staff.page.waitForTimeout(300)
    check('new messages trigger a fresh brief', (await aiCalls()).length === before + 1)
    before = (await aiCalls()).length
    await staff.page.click('button:has-text("Refresh Summary")')
    await staff.page.waitForSelector('text=Already up to date')
    check('no new messages reuses the saved brief without calling the AI', (await aiCalls()).length === before)
    check('brief lists the channels it covers', await staff.page.isVisible('text=Covers General, Announcements, Team Member'))
    await mgr.page.fill('#chat-text', 'Ice machine is broken in the kitchen')
    await mgr.page.click('button:has-text("Post")')
    await mgr.page.waitForSelector('article:has-text("Ice machine")')
    await staff.page.click('button:has-text("Refresh Summary")')
    await staff.page.waitForSelector('text=refreshed moments ago')
    check('cooldown stops repeat AI calls within a minute', (await aiCalls()).length === before)
    const [copyOk] = await Promise.all([
      staff.ctx.grantPermissions(['clipboard-read', 'clipboard-write']).then(() => true),
    ])
    await staff.page.click('button:has-text("Copy")')
    const clip = await staff.page.evaluate(() => navigator.clipboard.readText())
    check('Copy puts the brief on the clipboard as text', copyOk && clip.includes('CRITICAL ISSUES'), clip.slice(0, 60))
  })

  // 19. Older messages, date separators and jump to latest
  await step('history and scrolling', async () => {
    const wp = sql(`select id from workplaces where join_code = '${joinCode}';`)
    const author = sql(`select id from auth.users where email = '${email('mia')}';`)
    sql(`insert into messages (workplace_id, channel, author_id, content, created_at)
         select '${wp}', 'team_member', '${author}', 'Older note ' || g, now() - interval '1 day' - (g || ' minutes')::interval
         from generate_series(1, 60) g;`)
    await staff.page.click('nav >> text=Team Member')
    await staff.page.waitForSelector('main h1:text-is("Team Member")')
    await staff.page.waitForSelector('text=Show earlier messages', { timeout: 8000 })
    const firstCount = await staff.page.locator('article').count()
    await staff.page.click('text=Show earlier messages')
    await staff.page.waitForFunction((n) => document.querySelectorAll('article').length > n, firstCount, { timeout: 8000 })
    check('Show earlier messages loads older history', (await staff.page.locator('article').count()) > firstCount)
    check('messages are grouped under date headings', await staff.page.isVisible('[role="separator"]:has-text("Yesterday")'))
    await staff.page.evaluate(() => { const f = document.querySelector('article').closest('.overflow-y-auto'); f.scrollTop = 0; f.dispatchEvent(new Event('scroll')) })
    await mgr.page.click('nav >> text=Team Member')
    await mgr.page.waitForSelector('main h1:text-is("Team Member")')
    await mgr.page.fill('#chat-text', 'Can someone check the linen cupboard')
    await mgr.page.click('button:has-text("Post")')
    await staff.page.waitForSelector('button:has-text("1 new message")', { timeout: 8000 })
    check('a "new message" button appears when scrolled up', true)
    await staff.page.click('button:has-text("1 new message")')
    await staff.page.waitForSelector('button:has-text("1 new message")', { state: 'detached', timeout: 5000 })
    check('tapping it jumps to the latest message', true)
  })

  // 20. Removing a member and resetting the code
  await step('remove member and reset code', async () => {
    await mgr.page.click('nav >> text=Manage Team')
    await mgr.page.waitForSelector('text=Team members')
    const row = mgr.page.locator('li', { hasText: 'Lee Lead' })
    await row.locator('button[aria-label="Remove Lee Lead"]').click()
    await row.locator('button:has-text("Remove")').last().click()
    await mgr.page.waitForSelector('text=Lee Lead was removed')
    await lead.page.waitForSelector('text=no longer a member of Harbour Hotel', { timeout: 10000 })
    check('removed person is sent to setup with an explanation', true)
    const oldCode = joinCode
    await mgr.page.click('button:has-text("Reset code")')
    await mgr.page.click('button:has-text("Create new code")')
    await mgr.page.waitForSelector('text=old code no longer works')
    joinCode = (await mgr.page.textContent('.select-all')).trim()
    check('reset gives a different code', joinCode !== oldCode && /^[A-Z0-9]{6}$/.test(joinCode))
    await lead.page.fill('#join-code', oldCode)
    await lead.page.click('button:has-text("Join workplace")')
    await lead.page.waitForSelector('text=does not match any workplace')
    check('old code stops working', true)
    await lead.page.fill('#join-code', joinCode)
    await lead.page.click('button:has-text("Join workplace")')
    await lead.page.waitForSelector('text=Welcome to the team')
    check('new code works', true)
  })

  // 21. Forgot password
  await step('forgot password', async () => {
    const p = (await newUser(browser, 'reset')).page
    await p.goto(`${BASE}/login`)
    await p.click('text=Forgot password?')
    await p.fill('#reset-email', email('oli'))
    await p.click('button:has-text("Send reset link")')
    await p.waitForSelector('text=Check your email')
    check('reset request confirms a link was sent', true)
    const r = await fetch('http://127.0.0.1:54321/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', email: email('oli'), redirect_to: `${BASE}/reset-password` }),
    }).then((x) => x.json())
    await p.goto(r.action_link)
    await p.waitForSelector('text=Choose a new password', { timeout: 10000 })
    check('reset link opens the new password screen', true)
    await p.fill('#reset-password', 'brandnew789')
    await p.fill('#reset-confirm', 'brandnew789')
    await p.click('button:has-text("Save new password")')
    await p.waitForSelector('text=Your Shift Brief', { timeout: 10000 })
    check('saving the new password signs you in', true)
    await outsider.page.click('button[aria-label="Sign out"]')
    await outsider.page.fill('#login-email', email('oli'))
    await outsider.page.fill('#login-password', 'brandnew789')
    await outsider.page.click('button:has-text("Sign in")')
    await outsider.page.waitForSelector('text=Your Shift Brief')
    check('new password works on another device', true)
  })

  // 22. Installable on phones
  await step('install', async () => {
    const m = await fetch(`${BASE}/manifest.webmanifest`).then((x) => x.json())
    const icon = await fetch(`${BASE}${m.icons[1].src}`)
    check('web app manifest and icons are served', m.name === 'Handover' && m.display === 'standalone' && icon.ok)
  })

  // 23. Tracked issues carry over beyond 24 hours
  await step('tracked issues', async () => {
    const idOf = (who) => sql(`select id from auth.users where email = '${email(who)}';`)
    const wp = sql(`select workplace_id from profiles where id = '${idOf('mia')}';`)
    const issueWhere = (title) => `workplace_id = '${wp}' and title ilike '${title}%'`
    // Skip the one-minute cooldown between steps, then refresh and wait for the result.
    async function refresh(u) {
      sql(`update summaries set created_at = now() - interval '5 minutes' where user_id = (select id from auth.users where email = '${email(u.label === 'manager' ? 'mia' : u.label === 'staff' ? 'sid' : 'lee')}');`)
      await u.page.click('nav >> text=Home')
      await u.page.waitForSelector('text=Your Shift Brief')
      await u.page.click('button:has-text("Refresh Summary")')
      await u.page.waitForFunction(() => !document.body.innerText.includes('Summarising'), null, { timeout: 15000 })
      await u.page.waitForTimeout(400)
    }
    async function post(u, channel, text) {
      await u.page.click(`nav >> text=${channel}`)
      await u.page.waitForSelector(`main h1:text-is("${channel}")`)
      await u.page.fill('#chat-text', text)
      await u.page.click('button:has-text("Post")')
      await u.page.waitForSelector(`article:has-text("${text.slice(0, 20)}")`)
    }
    if (await lead.page.isVisible('button:has-text("Get Started")')) await lead.page.click('button:has-text("Get Started")')

    await post(mgr, 'General', 'Walk-in freezer door is broken and will not close')
    await refresh(mgr)
    await mgr.page.waitForSelector('[data-testid="critical"] li:has-text("Walk-in freezer")')
    check('the brief records a new issue from the chat', true)
    check('a new issue shows how long it has been open',
      (await mgr.page.textContent('[data-testid="critical"] li:has-text("Walk-in freezer") [data-testid="issue-age"]')).includes('open under an hour'))

    // Pretend it was raised three days ago: its message is now outside the 24-hour window.
    sql(`update messages set created_at = now() - interval '3 days' where workplace_id = '${wp}' and content like 'Walk-in freezer%';
         update issues set created_at = now() - interval '3 days' where ${issueWhere('Walk-in freezer')};`)
    await post(staff, 'General', 'Bread delivery arriving at 7am tomorrow')
    await refresh(staff)
    const calls = await aiCalls()
    const prompt = calls[calls.length - 1].body.messages[0].content
    const issueBlock = (prompt.match(/<open_issues>([\s\S]*?)<\/open_issues>/) || [])[1] || ''
    check('open issues are sent to the AI as context',
      issueBlock.split('\n').some((l) => l.includes('open 3 days') && l.includes('Walk-in freezer')), issueBlock.slice(0, 200))
    check('the freezer message itself is no longer in the 24-hour window', !/<messages>[\s\S]*Walk-in freezer[\s\S]*<\/messages>/.test(prompt))
    await staff.page.waitForSelector('[data-testid="critical"] li:has-text("Walk-in freezer")')
    check('an issue older than 24 hours stays on the brief with its age',
      (await staff.page.textContent('[data-testid="critical"] li:has-text("Walk-in freezer") [data-testid="issue-age"]')) === 'open 3 days')
    check('the same problem is not added twice', Number(sql(`select count(*) from issues where ${issueWhere('Walk-in freezer')}`)) === 1)
    check('team members see issues but no resolve or assign controls', (await staff.page.locator('button:has-text("Mark resolved")').count()) === 0)

    // Assign an owner from the brief.
    const freezer = mgr.page.locator('[data-testid="critical"] li', { hasText: 'Walk-in freezer' })
    await mgr.page.reload()
    await freezer.locator('select').selectOption({ label: 'Sid Sparks' })
    await staff.page.waitForSelector('[data-testid="critical"] li:has-text("Walk-in freezer") >> text=Owner: Sid Sparks', { timeout: 8000 })
    check('a manager can assign an owner and everyone sees it live', true)

    // A Management issue stays out of sight for team members, and they can't own it.
    await post(mgr, 'Management', 'Office safe lock is broken')
    await refresh(mgr)
    await mgr.page.waitForSelector('[data-testid="critical"] li:has-text("Office safe")')
    const safeOptions = await mgr.page.locator('[data-testid="critical"] li', { hasText: 'Office safe' }).locator('option').allTextContents()
    check('only people who can see the channel are offered as owners', !safeOptions.includes('Sid Sparks'), safeOptions.join(', '))
    await staff.page.reload()
    await staff.page.waitForSelector('[data-testid="critical"]')
    check('team members cannot see Management issues', !(await staff.page.isVisible('text=Office safe')))

    // The AI resolves an issue when the chat says it is fixed.
    await post(staff, 'General', 'Fixed the freezer door, it closes properly now')
    await refresh(staff)
    await staff.page.waitForSelector('[data-testid="resolved"] li:has-text("Walk-in freezer")')
    check('the brief marks an issue resolved when the chat says it is fixed',
      (await staff.page.textContent('[data-testid="resolved"] li:has-text("Walk-in freezer")')).includes('from the chat'))
    await mgr.page.waitForSelector('[data-testid="resolved"] li:has-text("Walk-in freezer")', { timeout: 8000 })
    check('resolved issues update live for others', !(await mgr.page.isVisible('[data-testid="critical"] li:has-text("Walk-in freezer")')))

    // A supervisor resolves and reopens from the brief.
    sql(`update profiles set role = 'supervisor' where id = '${idOf('lee')}';`)
    await post(mgr, 'General', 'Spill on the lobby carpet near the lift')
    await refresh(mgr)
    await lead.page.reload()
    await lead.page.click('button[aria-label="Open menu"]')
    await lead.page.click('.fixed nav >> text="Home"')
    const spill = lead.page.locator('[data-testid="critical"] li', { hasText: 'lobby carpet' })
    await spill.locator('button:has-text("Mark resolved")').click()
    await staff.page.waitForSelector('[data-testid="resolved"] li:has-text("lobby carpet") >> text=by Lee Lead', { timeout: 8000 })
    check('a supervisor can mark an issue resolved from the brief', true)
    await lead.page.locator('[data-testid="resolved"] li', { hasText: 'lobby carpet' }).locator('button:has-text("Reopen")').click()
    await staff.page.waitForSelector('[data-testid="critical"] li:has-text("lobby carpet")', { timeout: 8000 })
    check('a resolved issue can be reopened', true)

    // Cost controls: nothing new in 24 hours means no AI call, but open issues still show.
    sql(`update messages set created_at = now() - interval '2 days' where workplace_id = '${wp}';`)
    const before = (await aiCalls()).length
    await refresh(staff)
    await staff.page.waitForSelector('text=No messages in the last 24 hours')
    check('no AI call when nothing was posted in 24 hours', (await aiCalls()).length === before)
    check('open issues still show when nothing new was posted', await staff.page.isVisible('[data-testid="critical"] li:has-text("lobby carpet")'))
  })

  // 24. Push notifications
  await step('push notifications', async () => {
    sql(`select vault.create_secret('${PUSH_FUNCTION_URL}', 'push_function_url') where not exists (select 1 from vault.secrets where name = 'push_function_url');
         select vault.create_secret('local-push-secret', 'push_webhook_secret') where not exists (select 1 from vault.secrets where name = 'push_webhook_secret');`)
    await fetch(`${FAKE_PUSH}/__pushes`, { method: 'DELETE' })
    const waitPush = async (page, n, ms = 10000) => {
      const end = Date.now() + ms
      while (Date.now() < end) { const p = await pushesFor(page); if (p.length >= n) return p; await new Promise((r) => setTimeout(r, 300)) }
      return pushesFor(page)
    }
    const quiet = () => new Promise((r) => setTimeout(r, 3500))
    const subsOf = (who) => Number(sql(`select count(*) from push_subscriptions s join auth.users u on u.id = s.user_id where u.email = '${email(who)}';`))

    for (const u of [staff, mgr]) {
      await u.page.click('nav >> text=Notifications')
      await u.page.waitForSelector('[data-testid="push-status"][data-status="off"]')
    }
    check('Notifications page explains the iPhone Home Screen step', await staff.page.isVisible('text=Add to Home Screen') && await staff.page.isVisible('text=Using an iPhone or iPad?'))
    check('old "coming later" text is gone', !(await staff.page.isVisible('text=coming later')))
    if ((await staff.page.getAttribute('#notify-general', 'aria-checked')) === 'false') await staff.page.click('#notify-general')

    await staff.page.click('button:has-text("Turn on notifications")')
    await staff.page.waitForSelector('[data-testid="push-status"][data-status="on"]')
    await mgr.page.click('button:has-text("Turn on notifications")')
    await mgr.page.waitForSelector('[data-testid="push-status"][data-status="on"]')
    check('turning on saves this device', subsOf('sid') === 1 && subsOf('mia') === 1)

    await mgr.page.click('nav >> text=General')

    await mgr.page.waitForSelector('main h1:text-is("General")')
    await mgr.page.fill('#chat-text', 'Lift 2 is out of order, use the service lift')
    await mgr.page.click('button:has-text("Post")')
    const got = await waitPush(staff.page, 1)
    const p = got[0]
    check('staff gets a push for a new General message', !!p && p.payload.body.includes('Lift 2') && p.payload.title === 'Mia Manager in General' && p.payload.url === '/channels/general',
      p ? JSON.stringify(p.payload) : 'no push')
    check('push is encrypted and signed with VAPID',
      !!p && p.headers['content-encoding'] === 'aes128gcm' && /^vapid t=/.test(p.headers.authorization || '') && Number(p.headers.ttl) > 0)
    await quiet()
    check('the author is never notified', (await pushesFor(mgr.page)).length === 0)

    await mgr.page.click('nav >> text=Management')

    await mgr.page.waitForSelector('main h1:text-is("Management")')
    await mgr.page.fill('#chat-text', 'Budget review on Friday')
    await mgr.page.click('button:has-text("Post")')
    await quiet()
    check('no push to people who cannot access the channel', (await pushesFor(staff.page)).length === 1)

    await staff.page.click('#notify-general')
    await staff.page.waitForTimeout(500)
    await mgr.page.click('nav >> text=General')
    await mgr.page.waitForSelector('main h1:text-is("General")')
    await mgr.page.fill('#chat-text', 'Bins collected early tomorrow')
    await mgr.page.click('button:has-text("Post")')
    await quiet()
    check('a channel switched off in Notifications sends no push', (await pushesFor(staff.page)).length === 1)
    await staff.page.click('#notify-general')
    await staff.page.waitForTimeout(500)

    await staff.page.click('nav >> text=General')

    await staff.page.waitForSelector('main h1:text-is("General")')
    await staff.page.fill('#chat-text', 'Spill by the lobby doors, cleaning it now')
    await staff.page.click('button:has-text("Post")')
    const mgot = await waitPush(mgr.page, 1)
    check('manager gets a push when staff post', mgot.length === 1 && mgot[0].payload.title === 'Sid Sparks in General', mgot[0] ? mgot[0].payload.title : 'none')

    const staffId = sql(`select id from auth.users where email = '${email('sid')}';`)
    const ecdh = require('crypto').createECDH('prime256v1'); ecdh.generateKeys()
    const goneKey = ecdh.getPublicKey().toString('base64url')
    const goneAuth = require('crypto').randomBytes(16).toString('base64url')
    sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('${staffId}', '${FAKE_PUSH}/push/gone-${run}', '${goneKey}', '${goneAuth}');`)
    await mgr.page.fill('#chat-text', 'Fire door on level 3 propped open again')
    await mgr.page.click('button:has-text("Post")')
    await waitPush(staff.page, 2)
    await new Promise((r) => setTimeout(r, 1500))
    check('expired devices are cleaned up automatically', Number(sql(`select count(*) from push_subscriptions where endpoint like '%gone-${run}'`)) === 0)

    const staffEndpointId = (await staff.page.evaluate(() => JSON.parse(localStorage.getItem('__fakePush')).endpoint)).split('/').pop()
    const countFor = async (id) => (await fetch(`${FAKE_PUSH}/__pushes`).then((r) => r.json())).filter((x) => x.id === id).length
    const beforeOff = await countFor(staffEndpointId)
    await staff.page.click('nav >> text=Notifications')
    await staff.page.click('button:has-text("Turn off")')
    await staff.page.waitForSelector('[data-testid="push-status"][data-status="off"]')
    check('turning off removes this device', subsOf('sid') === 0)
    await mgr.page.fill('#chat-text', 'Last orders at 10pm tonight')
    await mgr.page.click('button:has-text("Post")')
    await quiet()
    check('no push after turning off', (await countFor(staffEndpointId)) === beforeOff)

    await mgr.page.click('button[aria-label="Sign out"]')
    await mgr.page.waitForSelector('#login-email')
    check('signing out stops notifications to that device', subsOf('mia') === 0)
  })

  // 25. Pilot: analytics, feedback, manager checklist, AI cap, founder dashboard, demo
  await step('pilot tools', async () => {
    const idOf = (who) => sql(`select id from auth.users where email = '${email(who)}';`)
    const harbour = sql(`select workplace_id from profiles where id = '${idOf('mia')}';`)

    // Usage analytics: counts only.
    check('app opens and brief views are counted per workplace',
      Number(sql(`select coalesce(sum(opens), 0) from activity_days where workplace_id = '${harbour}';`)) > 0 &&
      Number(sql(`select coalesce(sum(brief_views), 0) from activity_days where workplace_id = '${harbour}';`)) > 0)
    check('AI tokens are logged per workplace',
      Number(sql(`select coalesce(sum(input_tokens + output_tokens), 0) from ai_usage where workplace_id = '${harbour}';`)) > 0)
    check('analytics tables hold no text at all',
      sql(`select count(*) from information_schema.columns where table_name in ('activity_days', 'ai_usage') and data_type in ('text', 'character varying', 'jsonb');`) === '0')

    // Send feedback, tagged with the screen it came from.
    await staff.page.goto(`${BASE}/channels/general`)
    await staff.page.waitForSelector('main h1:text-is("General")')
    await staff.page.click('button:has-text("Send feedback")')
    await staff.page.fill('#feedback-message', `The brief button is hard to find ${run}`)
    await staff.page.click('role=dialog >> button:has-text("Send feedback")')
    await staff.page.waitForSelector('text=Your feedback was sent')
    await staff.page.click('role=dialog >> button:has-text("Done")')
    check('feedback is saved with the venue, screen and app version',
      sql(`select screen || '|' || (app_version is not null) from feedback where workplace_id = '${harbour}' and message like '%${run}';`) === 'Chat: General|true')

    // First-run checklist for a manager at a brand new venue.
    await outsider.page.goto(BASE)
    await outsider.page.waitForSelector('[data-testid="manager-checklist"]')
    const stepDone = async (k) => (await outsider.page.getAttribute(`[data-step="${k}"]`, 'data-done')) === 'true'
    check('new managers see a setup checklist', !(await stepDone('staff_invited')) && !(await stepDone('announcement_posted')))
    await outsider.page.goto(`${BASE}/channels/announcements`)
    await outsider.page.waitForSelector('main h1:text-is("Announcements")')
    await outsider.page.fill('#chat-text', 'Welcome to Handover, team!')
    await outsider.page.click('button:has-text("Post")')
    await outsider.page.waitForSelector('article:has-text("Welcome to Handover")')
    await outsider.page.goto(BASE)
    await outsider.page.waitForSelector('[data-testid="manager-checklist"]')
    check('checklist steps tick themselves off from real activity', await stepDone('announcement_posted'))
    check('team members don\'t see the manager checklist', (await staff.page.locator('[data-testid="manager-checklist"]').count()) === 0)
    await outsider.page.click('button:has-text("Hide this list")')
    await outsider.page.reload()
    await outsider.page.waitForSelector('text=Your Shift Brief')
    check('the checklist can be hidden for good', (await outsider.page.locator('[data-testid="manager-checklist"]').count()) === 0)

    // Daily cap on fresh briefs per workplace.
    sql(`update workplaces set daily_ai_cap = (select coalesce(max(calls), 0) from ai_usage where workplace_id = '${harbour}' and day = pilot_today()) where id = '${harbour}';`)
    await staff.page.goto(`${BASE}/channels/general`)
    await staff.page.waitForSelector('main h1:text-is("General")')
    await staff.page.fill('#chat-text', 'Bar 2 tap is leaking slightly')
    await staff.page.click('button:has-text("Post")')
    await staff.page.waitForSelector('article:has-text("Bar 2 tap")')
    sql(`update summaries set created_at = now() - interval '5 minutes' where user_id = '${idOf('sid')}';`)
    const callsBefore = (await aiCalls()).length
    await staff.page.goto(BASE)
    await staff.page.click('button:has-text("Refresh Summary")')
    await staff.page.waitForSelector("text=used today's", { timeout: 15000 })
    check('the daily brief limit stops AI calls and explains why', (await aiCalls()).length === callsBefore)
    sql(`update workplaces set daily_ai_cap = 40 where id = '${harbour}';`)

    // Founder dashboard: only for admins, and only with two-factor sign-in.
    await staff.page.goto(`${BASE}/admin`)
    await staff.page.waitForSelector('text=This page is for the Handover team')
    check('the founder dashboard is closed to everyone else', true)
    sql(`insert into platform_admins (user_id) values ('${idOf('mia')}') on conflict do nothing;`)
    await mgr.page.goto(`${BASE}/login`)
    if (await mgr.page.isVisible('#login-email')) {
      await mgr.page.fill('#login-email', email('mia'))
      await mgr.page.fill('#login-password', 'password123')
      await mgr.page.click('button:has-text("Sign in")')
      await mgr.page.waitForSelector('text=Your Shift Brief')
    }
    await mgr.page.waitForSelector('nav >> text=Founder dashboard')
    await mgr.page.click('nav >> text=Founder dashboard')
    await mgr.page.waitForSelector('text=Set up two-factor sign-in')
    check('admins must set up two-factor sign-in first', true)
    const secret = (await mgr.page.textContent('[data-testid="totp-secret"]')).trim()
    await mgr.page.fill('#totp-code', '000000')
    await mgr.page.click('button:has-text("Continue")')
    await mgr.page.waitForSelector("text=That code didn't work")
    check('a wrong code is refused', true)
    await mgr.page.fill('#totp-code', totp(secret))
    await mgr.page.click('button:has-text("Continue")')
    await mgr.page.waitForSelector('h1:text-is("Pilot venues")', { timeout: 15000 })
    const card = mgr.page.locator('[data-testid="venue"][data-venue="Harbour Hotel"]')
    await card.waitFor()
    const cardText = await card.textContent()
    check('the dashboard shows per-venue counts', /Active this week/.test(cardText) && /Push opt-in/.test(cardText) && /AI cost/.test(cardText))
    const pageText = await mgr.page.textContent('main')
    check('the dashboard shows no message content', !pageText.includes('Fridge 3') && !pageText.includes('Bar 2 tap'))
    check('feedback appears on the dashboard', pageText.includes(`hard to find ${run}`) && pageText.includes('Chat: General'))
    await card.locator('input[type="number"]').fill('55')
    await card.locator('button:has-text("Save")').click()
    await card.locator('text=Saved').waitFor()
    check('admins can change a venue\'s daily brief limit', sql(`select daily_ai_cap from workplaces where id = '${harbour}';`) === '55')

    // Demo workspace: one-click reset from the dashboard, then sign in as a prospect.
    await mgr.page.click('button:has-text("Reset demo")')
    await mgr.page.click('button:has-text("Yes, reset demo")')
    await mgr.page.waitForSelector('text=Demo reset', { timeout: 30000 })
    check('the demo resets with fresh sample data',
      sql(`select count(*) from messages m join workplaces w on w.id = m.workplace_id where w.is_demo;`) === '16')
    const prospect = await newUser(browser, 'prospect', { width: 390, height: 844 })
    await prospect.page.goto(`${BASE}/login`)
    await prospect.page.fill('#login-email', 'demo.staff1@demo.handover.test')
    await prospect.page.fill('#login-password', 'HandoverDemo-2026')
    await prospect.page.click('button:has-text("Sign in")')
    await prospect.page.waitForSelector('[data-testid="demo-banner"]')
    check('demo accounts open straight into a realistic workspace', (await prospect.page.locator('[data-testid="critical"] li').count()) > 0)
    await prospect.page.goto(`${BASE}/settings/account`)
    await prospect.page.waitForSelector('text=This is a demo account')
    check('demo accounts can\'t change email, password, leave or delete', (await prospect.page.locator('button:has-text("Delete my account")').count()) === 0)
  })

  // 26. Privacy Policy, Terms, CORS and error monitoring
  await step('launch readiness', async () => {
    const visitor = await newUser(browser, 'visitor')
    await visitor.page.goto(`${BASE}/login`)
    await visitor.page.click('text=Privacy Policy')
    await visitor.page.waitForSelector('h1:text-is("Privacy Policy")')
    check('the Privacy Policy opens without signing in', await visitor.page.isVisible('text=Australian Privacy Principles'))
    check('unfilled placeholders are highlighted', (await visitor.page.locator('mark').count()) > 0)
    check('the usage statistics and feedback wording is shown and marked as a draft',
      await visitor.page.isVisible('[data-testid="draft-usage"] >> text=Draft: pending legal review') &&
      (await visitor.page.textContent('[data-testid="draft-usage"]')).includes("don't use third-party analytics"))
    await visitor.page.goto(`${BASE}/terms`)
    await visitor.page.waitForSelector('h1:text-is("Terms of Use")')
    check('the Terms of Use open without signing in', await visitor.page.isVisible('text=Australian Consumer Law'))
    await staff.page.goto(`${BASE}/privacy`)
    await staff.page.waitForSelector('h1:text-is("Privacy Policy")')
    check('signed-in people can open the Privacy Policy too', true)

    const fn = process.env.SHIFT_BRIEF_URL || 'http://127.0.0.1:8000'
    const evil = await fetch(fn, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } })
    check('functions refuse other websites (preflight)', evil.status === 403 && !evil.headers.get('access-control-allow-origin'))
    const evilPost = await fetch(fn, { method: 'POST', headers: { Origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })
    check('functions refuse requests from other websites', evilPost.status === 403)
    const good = await fetch(fn, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } })
    check('functions allow the app\'s own address', good.status === 204 && good.headers.get('access-control-allow-origin') === 'http://localhost:5173')

    const sentryEvents = () => fetch(`${FAKE_SENTRY}/__events`).then((r) => r.json())
    await staff.page.goto(`${BASE}/settings/notifications?ref=secret-query#private-hash`)
    await staff.page.waitForSelector('text=Notifications on this device')
    await staff.page.evaluate(async (tag) => {
      window.__handoverSentry.captureException(new Error(tag))
      await window.__handoverSentry.flush(3000)
    }, `e2e sentry check ${run}`)
    await new Promise((r) => setTimeout(r, 500))
    const fe = (await sentryEvents()).find((e) => e.project === '1' && e.raw.includes(`e2e sentry check ${run}`))
    const staffId = sql(`select id from auth.users where email = '${email('sid')}';`)
    check('front-end errors reach Sentry', !!fe)
    check('front-end reports carry only the account id, no email or address details',
      !!fe && JSON.stringify(fe.event.user) === JSON.stringify({ id: staffId }) && !fe.raw.includes(email('sid')) &&
      !fe.raw.includes('secret-query') && !fe.raw.includes('private-hash'))

    await staff.page.click('nav >> text=General')
    await staff.page.waitForSelector('main h1:text-is("General")')
    await staff.page.fill('#chat-text', 'Coffee machine making a grinding noise')
    await staff.page.click('button:has-text("Post")')
    await staff.page.waitForSelector('article:has-text("Coffee machine making")')
    sql(`update summaries set created_at = now() - interval '5 minutes' where user_id = '${staffId}';`)
    await fetch(`${FAKE_AI}/__fail_next`, { method: 'POST' })
    await staff.page.click('nav >> text=Home')
    await staff.page.click('button:has-text("Refresh Summary")')
    await staff.page.waitForSelector('text=The brief could not be generated', { timeout: 20000 })
    check('an AI outage shows a friendly message', true)
    await new Promise((r) => setTimeout(r, 1500))
    const be = (await sentryEvents()).find((e) => e.project === '2' && e.event.tags?.function === 'shift-brief')
    check('Edge Function errors reach Sentry, tagged with the function', !!be)
    check('Edge Function reports contain no message text or email', !!be && !be.raw.includes('Coffee machine') && !be.raw.includes(email('sid')))
    const tx = (await sentryEvents()).filter((e) => e.project === '2' && e.type === 'transaction' && e.event.transaction === 'shift-brief')
    check('function calls are recorded with their outcome, for failure-rate alerts',
      tx.some((t) => t.event.contexts?.trace?.status === 'ok') && tx.some((t) => t.event.contexts?.trace?.status === 'internal_error'),
      tx.map((t) => t.event.contexts?.trace?.status).join(','))
  })

  // 27. Export my data and delete my account
  await step('export and delete', async () => {
    async function openSettings(u, name) {
      if (await u.page.isVisible('button[aria-label="Open menu"]')) {
        await u.page.click('button[aria-label="Open menu"]')
        await u.page.click(`.fixed nav >> text="${name}"`)
      } else {
        await u.page.click(`nav >> text="${name}"`)
      }
      await u.page.waitForSelector(`main h1:text-is("${name}")`)
    }
    async function deleteAccount(u, alsoMessages) {
      await openSettings(u, 'Account')
      await u.page.click('button:has-text("Delete my account")')
      if (alsoMessages) await u.page.check('#delete-messages')
      await u.page.click('button:has-text("Yes, delete my account")')
    }
    const exists = (who) => sql(`select count(*) from auth.users where email = '${email(who)}';`) === '1'
    const harbour = sql(`select workplace_id from profiles where id = (select id from auth.users where email = '${email('mia')}');`)

    // Export
    await openSettings(staff, 'Account')
    const [download] = await Promise.all([
      staff.page.waitForEvent('download', { timeout: 15000 }),
      staff.page.click('button:has-text("Download my data")'),
    ])
    const file = JSON.parse(fs.readFileSync(await download.path(), 'utf8'))
    check('Export my data downloads your account details', file.account?.email === email('sid') && file.workplace?.name === 'Harbour Hotel')
    check('the export includes your own messages only',
      file.messages.some((m) => m.text.includes('Fridge 3')) && !file.messages.some((m) => m.text.includes('Lift 2')))
    check('the export leaves out device keys', !JSON.stringify(file).includes('p256dh'))

    // The only manager can't delete their account while others remain.
    await mgr.page.goto(`${BASE}/login`)
    if (await mgr.page.isVisible('#login-email')) {
      await mgr.page.fill('#login-email', email('mia'))
      await mgr.page.fill('#login-password', 'password123')
      await mgr.page.click('button:has-text("Sign in")')
      await mgr.page.waitForSelector('text=Your Shift Brief')
    }
    await deleteAccount(mgr, false)
    await mgr.page.waitForSelector('text=You are the only manager')
    check('the only manager is asked to hand over before deleting', exists('mia'))

    // A supervisor deletes their account and their messages.
    await lead.page.goto(`${BASE}/channels/general`)
    await lead.page.waitForSelector('main h1:text-is("General")')
    await lead.page.fill('#chat-text', 'Lead note that should disappear')
    await lead.page.click('button:has-text("Post")')
    await lead.page.waitForSelector('article:has-text("Lead note that should")')
    await deleteAccount(lead, true)
    await lead.page.waitForSelector('text=Your account has been deleted', { timeout: 15000 })
    check('deleting your account signs you out and confirms it', !exists('lee'))
    check('choosing to delete your messages removes them',
      sql(`select count(*) from messages where content like 'Lead note that should%';`) === '0')

    // A team member deletes their account but leaves their messages for the team.
    await deleteAccount(staff, false)
    await staff.page.waitForSelector('text=Your account has been deleted', { timeout: 15000 })
    await staff.page.fill('#login-email', email('sid'))
    await staff.page.fill('#login-password', 'newpassword456')
    await staff.page.click('button:has-text("Sign in")')
    await staff.page.waitForSelector('text=do not match')
    check('a deleted account can no longer sign in', !exists('sid'))
    await mgr.page.goto(`${BASE}/channels/general`)
    await mgr.page.waitForSelector('article:has-text("Fridge 3")')
    check('kept messages show as from a former member',
      (await mgr.page.textContent('article:has-text("Fridge 3")')).includes('Former member'))
    check('the workplace and its data are untouched', sql(`select count(*) from workplaces where id = '${harbour}';`) === '1')

    // The last person in a workplace can delete their account; the empty workplace goes too.
    await outsider.page.goto(`${BASE}/settings/account`)
    await outsider.page.waitForSelector('main h1:text-is("Account")')
    await deleteAccount(outsider, false)
    await outsider.page.waitForSelector('text=Your account has been deleted', { timeout: 15000 })
    check('the last person can delete their account, removing the empty workplace',
      !exists('oli') && sql(`select count(*) from workplaces where name = 'Other Cafe';`) === '0')
  })

  check('no browser errors during the walkthrough', errors.length === 0, errors.slice(0, 5).join(' | '))

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  await browser.close()
  process.exit(failed.length ? 1 : 0)
})()
