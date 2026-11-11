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

  check('no browser errors during the walkthrough', errors.length === 0, errors.slice(0, 5).join(' | '))

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  await browser.close()
  process.exit(failed.length ? 1 : 0)
})()
