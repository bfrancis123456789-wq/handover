# Launch checklist

What still stands between Handover and real customers. Items in the first list block a safe launch; the second list can follow soon after.

## Before launch

- [ ] **Fill in and get legal review of the Privacy Policy and Terms**, including the new draft section on usage statistics, feedback and backups. Every bracketed value in `src/lib/legal.js` and on `/privacy` and `/terms` (company name, ABN, contacts, retention periods, minimum age, fees, liability cap, governing state). Replace `SUPPORT_EMAIL` in `src/lib/constants.js`.
- [ ] **Production Supabase project in Sydney (ap-southeast-2) on a paid plan.** The free plan has no backups and pauses inactive projects. Turn on daily backups (and point-in-time recovery if you can).
- [ ] **Auth settings in the dashboard:** Site URL and Redirect URLs; your own SMTP provider; minimum password length 8 (hosted default is 6); decide on email confirmation; turn on leaked-password protection; add CAPTCHA (Cloudflare Turnstile or hCaptcha) to signup and password reset to stop bot accounts.
- [ ] **Secrets and functions** for staging and production, as listed in `docs/deploy.md` (functions deploy automatically from GitHub).
- [x] **Hosting with security headers.** Done in `public/_headers` for Cloudflare Pages (CSP, HSTS, nosniff, referrer policy, no framing), and checked in CI by `e2e/csp-check.cjs`.
- [ ] **Agreements with providers.** Anthropic commercial terms (confirm messages aren't used for training and check retention), Supabase and Sentry data processing agreements, and Sentry's data region. Make sure the Privacy Policy names each one.
- [ ] **Real-device checks.** Push notifications on an Android phone and an iPhone (installed to the Home Screen), password reset email end to end, and a few real shift briefs with your Anthropic key to check issue titles and "resolved" judgements.
- [ ] **First green CI run on GitHub** (Actions tab). It runs on every push from now on.
- [ ] **Accounts, secrets and first deploy:** follow `docs/deploy.md`, then run `docs/pilot-dry-run.md`.
- [ ] **Sentry alert rules** from `docs/monitoring.md`.

## Soon after launch

- [ ] **Re-confirm identity before changing password or email.** Right now anyone with an unlocked, signed-in phone could change them. Supabase's "secure password change" needs a small re-authentication screen.
- [ ] **Ask people to agree again when the Terms change.** The accepted version is recorded at signup (`terms_version`), but nothing prompts for re-acceptance yet.
- [ ] **Enforce the minimum age** stated in the Terms at signup, if you need one.
- [ ] **Close a workplace.** There's no way for a manager to delete a whole workplace yet, which the Privacy Policy's retention section and customer offboarding will need.
- [ ] **Scheduled clean-up.** Old shift briefs, join attempts, activity counts and feedback are kept forever. Add a daily job (Supabase cron) to delete them after the periods stated in the Privacy Policy.
- [x] **Spending cap for the brief.** Daily limit per workplace (default 40 fresh briefs), adjustable on the founder dashboard; tokens logged per venue.
- [ ] **Report a message.** Moderation is currently "managers can delete". A simple report button helps with harassment complaints.
- [ ] **Uptime check** on the app and functions (Sentry alert rules are in `docs/monitoring.md`).
- [ ] **Data breach response plan** for the Notifiable Data Breaches scheme: who decides, who contacts the OAIC and affected people, within 30 days.

## Known, low-risk limitations

- Profile photos are in a public bucket: anyone with a photo's exact link can view it. Links are long and random.
- Supabase sends "like removed" realtime events to all subscribers without checking access (only the message and person IDs, no content).
