<p align="center"><img src="public/brand/handover-logo-full.png" alt="Handover" width="320"></p>

# Handover

Keep every shift on the same page. Handover is a workplace chat app for shift-based teams in hospitality, retail and hotels. It replaces messy group chats with role-based channels, and uses AI to turn the last 24 hours of messages into a short shift brief.

**Stack:** React 19 + Vite + Tailwind CSS 4 · Supabase (Auth, Postgres, Storage, Realtime, Edge Functions) · Claude Haiku 5.5 via the Anthropic API

## Features

**Chat**
- Five channels: General and Team Member for everyone, Announcements that everyone reads but only supervisors and managers post in, Supervisors for supervisors and managers, Management for managers only
- Live messages, photos (resized on the phone before upload), likes, and full-screen photos with Save
- Unread counts on each channel, in the browser tab and on the phone menu button. Channels muted in Notifications show a quiet dot instead of a number
- Date headings, "Show earlier messages", and a "new messages" button when you've scrolled up
- Delete your own messages; managers can delete any message

**Shift Brief and tracked issues**
- Problems become tracked issues that stay on the brief until someone resolves them, showing how long they've been open ("open 3 days") and who owns them
- Claude reads the last 24 hours from the channels you can see, plus the open issues, and returns new issues, issues now resolved and the next priorities. The server checks every update against real messages before saving
- Supervisors and managers can mark issues resolved, reopen them, and assign an owner from the brief
- Home shows Critical Issues, Ongoing Items, Resolved Today and Next Priority, updated live
- Safety, equipment, stock and guest complaints come first; small talk is left out
- Reuses the saved brief when nothing new has been posted, and allows one fresh brief per person per minute, so it stays fast and cheap
- Copy the brief as text to paste into an email or message

**Team and account**
- Create a workplace (you become the manager) or join with a 6-character code
- Managers change roles, remove people who have left, and reset the join code
- Push notifications on phones and computers for new messages, with per-channel on/off, never for your own messages, and only for channels you can see
- Profile photo and name, change email or password, forgot password, leave workplace
- Export my data (a file with your profile, settings and messages) and Delete my account, with the option to delete your messages too
- Privacy Policy and Terms of Use pages, agreed to at signup
- Welcome dialog on first login, with different text for managers and staff
- Installable on phones (Add to Home Screen) with its own icon

## Setup

1. **Create a Supabase project** at supabase.com.
2. **Run the database migrations** in order, either by pasting each file in `supabase/migrations/` into the SQL editor, or with the CLI:
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```
3. **Deploy the Edge Functions and their secrets** (keys stay on the server and never reach the browser). `ALLOWED_ORIGINS` is your app's address; browsers on any other site are refused:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ALLOWED_ORIGINS=https://app.yourdomain.com.au
   supabase functions deploy shift-brief
   supabase functions deploy delete-account
   ```
   For more than one address (for example a staging site), separate them with commas.
4. **Configure the front end:**
   ```bash
   cp .env.example .env.local   # add your project URL and anon key
   npm install
   npm run dev
   ```

Brand files live in `public/brand/` (app icon, mark and full logo). The app uses `public/logo.png` and `public/favicon.png`, and phones use `public/icons/` and `public/apple-touch-icon.png`. To change the support address, edit `SUPPORT_EMAIL` in `src/lib/constants.js`.

## Push notifications

1. Create VAPID keys once: `npx web-push generate-vapid-keys`
2. Put the **public** key in the front end's `.env.local` as `VITE_VAPID_PUBLIC_KEY`.
3. Deploy the sender and give it its secrets (choose any long random string for the webhook secret):
   ```bash
   supabase functions deploy send-push --no-verify-jwt
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@yourdomain.com PUSH_WEBHOOK_SECRET=...
   ```
4. Tell the database where to send new-message events. In the SQL editor:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-push', 'push_function_url');
   select vault.create_secret('<the same webhook secret>', 'push_webhook_secret');
   ```

Until step 4 is done, nothing is sent. On iPhone and iPad, push only works once Handover has been added to the Home Screen (iOS 16.4 or later); the Notifications page explains this to staff.

How it works: when a message is posted, a database trigger calls `send-push` with the shared secret. The function asks `push_recipients()` who should be notified (same workplace, can access the channel, channel switched on, not the author), encrypts a notification for each of their devices, and removes devices that have expired.

## Error monitoring (Sentry)

1. Create a Sentry project for the front end (React) and one for the Edge Functions (Deno), or use one for both.
2. Front end: set `VITE_SENTRY_DSN` (and optionally `VITE_SENTRY_ENVIRONMENT`, `VITE_RELEASE`) in your hosting provider's environment settings.
3. Edge Functions: `supabase secrets set SENTRY_DSN=... SENTRY_ENVIRONMENT=production`

Reports include the error, a stack trace, the page path and the account ID. They never include names, email addresses, message text, request bodies or sign-in tokens (links are stripped before sending). Nothing is sent until a DSN is set.

## Privacy Policy and Terms

`/privacy` and `/terms` are drafts written with the Australian Privacy Act and Australian Consumer Law in mind. Fill in every bracketed value in `src/lib/legal.js` and in the pages themselves (anything unfilled is highlighted in yellow), then have a lawyer review both before launch. Change `TERMS_VERSION` in `src/lib/legal.js` when the documents change.

## Before going live

- **Authentication > URL Configuration:** set the Site URL to your app's address, and add `https://your-domain/**` to Redirect URLs. Password reset links won't work without this.
- **Authentication > SMTP Settings:** connect your own email provider (for example Resend, Postmark or SendGrid). Supabase's built-in email only sends a few messages per hour and is meant for testing, so signup confirmations and password resets will stall without it.
- **Authentication > Providers > Email:** decide whether new accounts must confirm their email. The app handles both. Set the minimum password length to **8** to match the app (the hosted default is 6).
- **Hosting:** `npm run build` produces a static site in `dist/` that you can host on Vercel, Netlify or similar. Set up a rewrite so every path serves `index.html`.

## How access is enforced

All rules live in the database, so the interface cannot bypass them.

| Rule | Where |
|---|---|
| Users only see their own workplace's profiles, messages, likes, briefs, photos and read markers | RLS policies built on `my_workplace_id()` |
| Supervisors channel: supervisors and managers. Management channel: managers only | `can_access_channel()`, used by message, like, storage and unread rules |
| Only managers change roles, remove members or reset the join code; a workplace always keeps a manager | `set_member_role()`, `remove_member()`, `regenerate_join_code()`; `role` and `workplace_id` can't be updated directly |
| Only supervisors and managers post in Announcements (photos included) | `can_post_in_channel()`, used by the message and photo upload rules |
| Authors delete their own messages; managers delete any in their workplace | `delete own or as manager` policy |
| The join code is only visible to managers | the column isn't granted to users; read through `get_join_code()` |
| The only manager can't leave while others remain | `leave_workplace()`. If they are the last person left, the workplace is deleted |
| Message photos are private | `message-images` bucket, path `<workplace>/<channel>/<file>`, served through signed URLs |
| Issues are visible only to people who can access their channel; an issue takes the most restricted channel among its source messages | `issues` policy, `apply_brief_updates()` |
| Only the shift-brief function records AI issue updates; only supervisors and managers resolve, reopen or assign, and owners must be able to see the channel | `apply_brief_updates()` (service role only), `resolve_issue()`, `reopen_issue()`, `assign_issue()` |
| Each person's brief only uses channels they can read | the Edge Function queries with the caller's token, so RLS applies, and gets the channel list from `my_channels()` |
| People see and remove only their own push devices; devices are saved through a checked function | `push_subscriptions` policies and `save_push_subscription()` |
| Push goes only to people in the workplace who can access the channel, have it switched on, and didn't write the message | `push_recipients()`, callable only by the `send-push` function (service role) |

## Testing

Two test suites run against a local Supabase stack (needs Docker, the Supabase CLI and Deno). GitHub Actions runs both on every push (`.github/workflows/ci.yml`), and uploads screenshots and logs if anything fails.

- `e2e/walkthrough.cjs`: 130 checks in a real browser with four people using the app at once: signup, joining, live chat, photos, likes, unread counts, deleting, roles, the brief, profile, notifications, passwords, leaving, removing members, push notifications (decrypted to check who received what), tracked issues carrying over beyond 24 hours, error reporting, CORS, exporting data, deleting accounts, phone layout and more.
- `e2e/security.sql`: 70 checks that act as different users directly against the database, proving the rules hold even without the app.

To run them on your machine:

```bash
supabase start
npm run test:e2e
```

`e2e/run-ci.sh` starts stand-ins for Claude, the push service and Sentry (no real keys needed), runs each Edge Function with Deno, starts the app, then runs both suites.

## Project layout

```
src/
  App.jsx                   routing: signed out → login, no workplace → setup, else the app
  context/AuthContext.jsx   session, profile, workplace (with live role updates)
  context/UnreadContext.jsx unread counts per channel
  components/               Layout (sidebar + phone menu), WelcomeDialog, ImageViewer, RoleBadge, Avatar…
  pages/                    Login, Signup, ForgotPassword, ResetPassword, WorkplaceSetup, Home, Chat
  pages/settings/           Profile, Notifications, Account, Help, ManageTeam
supabase/
  migrations/               schema, security rules, functions, storage, realtime
  functions/shift-brief/    Edge Function that calls Claude and records issue updates
  functions/send-push/      Edge Function that sends push notifications
  functions/delete-account/ Edge Function that deletes an account
  functions/_shared/        CORS and Sentry helpers
e2e/                        end-to-end and security tests, stand-in services, CI script
```
