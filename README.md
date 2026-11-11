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

**Shift Brief**
- Claude reads the last 24 hours from the channels you can see and lists Critical Issues, Ongoing Items, Resolved Today and Next Priority
- Safety, equipment, stock and guest complaints come first; small talk is left out
- Reuses the saved brief when nothing new has been posted, and allows one fresh brief per person per minute, so it stays fast and cheap
- Copy the brief as text to paste into an email or message

**Team and account**
- Create a workplace (you become the manager) or join with a 6-character code
- Managers change roles, remove people who have left, and reset the join code
- Profile photo and name, notification settings, change email or password, forgot password, leave workplace
- Welcome dialog on first login, with different text for managers and staff
- Installable on phones (Add to Home Screen) with its own icon

## Setup

1. **Create a Supabase project** at supabase.com.
2. **Run the database migrations** in order, either by pasting each file in `supabase/migrations/` into the SQL editor, or with the CLI:
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```
3. **Deploy the shift brief function and add your Anthropic key** (the key stays on the server and never reaches the browser):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy shift-brief
   ```
4. **Configure the front end:**
   ```bash
   cp .env.example .env.local   # add your project URL and anon key
   npm install
   npm run dev
   ```

Brand files live in `public/brand/` (app icon, mark and full logo). The app uses `public/logo.png` and `public/favicon.png`, and phones use `public/icons/` and `public/apple-touch-icon.png`. To change the support address, edit `SUPPORT_EMAIL` in `src/lib/constants.js`.

## Before going live

- **Authentication > URL Configuration:** set the Site URL to your app's address, and add `https://your-domain/**` to Redirect URLs. Password reset links won't work without this.
- **Authentication > SMTP Settings:** connect your own email provider (for example Resend, Postmark or SendGrid). Supabase's built-in email only sends a few messages per hour and is meant for testing, so signup confirmations and password resets will stall without it.
- **Authentication > Providers > Email:** decide whether new accounts must confirm their email. The app handles both.
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
| Each person's brief only uses channels they can read | the Edge Function queries with the caller's token, so RLS applies |

## Testing

Two test suites run against a local Supabase stack (needs Docker and the Supabase CLI):

- `e2e/walkthrough.cjs`: 76 checks in a real browser with four people using the app at once: signup, joining, live chat, photos, likes, unread counts, deleting, roles, the brief, profile, notifications, passwords, leaving, removing members, phone layout and more.
- `e2e/security.sql`: 25 checks that act as different users directly against the database, proving the rules hold even without the app.

```bash
supabase start
supabase functions serve --env-file supabase/functions/.env   # or run the function with Deno
node e2e/fake-anthropic.mjs                                    # stand-in for the Claude API, no key needed
```

Point the function at the stand-in by putting `ANTHROPIC_API_KEY=sk-ant-local-test` and `ANTHROPIC_BASE_URL=http://host.docker.internal:4010` in `supabase/functions/.env`. Then, in separate terminals:

```bash
npx vite --config e2e/vite.e2e.config.js
node e2e/walkthrough.cjs
docker exec -i supabase_db_handover psql -U postgres < e2e/security.sql
```

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
  functions/shift-brief/    Edge Function that calls Claude
e2e/                        end-to-end and security tests
```
