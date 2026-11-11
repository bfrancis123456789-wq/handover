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
const results = []
const errors = []

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -> ${detail}` : ''}`)
}

async function step(name, fn) {
  try { await fn() } catch (e) { check(name, false, e.message.split('\n')[0]) }
}

async function newUser(browser, label, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|WebSocket|status of 4\d\d/.test(m.text())) errors.push(`${label}: ${m.text()}`)
  })
  return { ctx, page, label }
}

async function signup(page, name, mail, password = 'password123') {
  await page.goto(`${BASE}/signup`)
  await page.fill('#signup-name', name)
  await page.fill('#signup-email', mail)
  await page.fill('#signup-password', password)
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
    await mgr.page.waitForSelector('text=Hi Mia, let\'s get you set up')
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
    await staff.page.waitForSelector('text=No messages in Announcements yet', { timeout: 8000 }).catch(() => {})
    check('empty channel shows friendly empty state', await staff.page.isVisible('text=No messages in Announcements yet'))
    check('team member cannot post in Announcements and is told why',
      (await staff.page.isVisible('text=Only managers and supervisors can post in Announcements')) && !(await staff.page.isVisible('#chat-text')))
    await mgr.page.click('nav >> text=General')
    await staff.page.click('nav >> text=General')
    await staff.page.fill('#chat-text', 'Fridge 3 is broken and leaking water')
    await staff.page.click('button:has-text("Post")')
    await staff.page.waitForSelector('article:has-text("Fridge 3 is broken")')
    check('post box clears after posting', (await staff.page.inputValue('#chat-text')) === '')
    await mgr.page.waitForSelector('article:has-text("Fridge 3 is broken")', { timeout: 8000 })
    check('manager sees the new message live without refreshing', true)
    const card = mgr.page.locator('article', { hasText: 'Fridge 3 is broken' })
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
    const row = mgr.page.locator('li', { hasText: 'Sid Staff' })
    await row.locator('select').selectOption('supervisor')
    await mgr.page.waitForSelector('text=Sid Staff is now a Supervisor')
    await staff.page.waitForSelector('nav >> text=Supervisors', { timeout: 8000 })
    check('promoted user sees Supervisors channel without reloading', true)
    const own = mgr.page.locator('li', { hasText: '(you)' })
    await own.locator('select').selectOption('team_member')
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
    await mgr.page.fill('#chat-text', 'Rota for next week is up')
    await mgr.page.click('button:has-text("Post")')
    await staff.page.waitForSelector('nav a:has-text("Announcements") [aria-label="1 unread"]', { timeout: 8000 })
    check('unread badge appears live in the sidebar', true)
    check('Home channel card shows new count', await staff.page.isVisible('text=1 new'))
    check('browser tab shows unread total', (await staff.page.title()).startsWith('(1)'), await staff.page.title())
    await staff.page.click('nav >> text=Announcements')
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
    await mgr.page.click('nav >> text=General')
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
    await staff.page.waitForSelector('text=Show earlier messages', { timeout: 8000 })
    const firstCount = await staff.page.locator('article').count()
    await staff.page.click('text=Show earlier messages')
    await staff.page.waitForFunction((n) => document.querySelectorAll('article').length > n, firstCount, { timeout: 8000 })
    check('Show earlier messages loads older history', (await staff.page.locator('article').count()) > firstCount)
    check('messages are grouped under date headings', await staff.page.isVisible('[role="separator"]:has-text("Yesterday")'))
    await staff.page.evaluate(() => { const f = document.querySelector('article').closest('.overflow-y-auto'); f.scrollTop = 0; f.dispatchEvent(new Event('scroll')) })
    await mgr.page.click('nav >> text=Team Member')
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

  check('no browser errors during the walkthrough', errors.length === 0, errors.slice(0, 5).join(' | '))

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  await browser.close()
  process.exit(failed.length ? 1 : 0)
})()
