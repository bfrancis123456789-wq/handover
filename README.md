# Handover

Keep every shift on the same page. Handover is a workplace chat app for shift-based teams (hospitality, retail, hotels). It has role-based channels, and an AI shift brief that summarises the last 24 hours of messages.

**Stack:** React 19 + Vite + Tailwind CSS 4 · Supabase (Auth, Postgres, Storage, Realtime, Edge Functions) · Claude Haiku 5.5 via the Anthropic API

## Setup

1. **Create a Supabase project** at supabase.com.
2. **Run the database migration.** Paste `supabase/migrations/20261111000000_init.sql` into the Supabase SQL editor and run it, or use the CLI:
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```
   This creates the tables, row level security policies, RPC functions, the storage buckets `avatars` and `message-images`, and the realtime publication.
3. **Deploy the shift brief function and add the Anthropic key** (the key stays on the server and never reaches the browser):
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
5. **Optional:** in Supabase > Authentication > Providers > Email, turn off "Confirm email" while testing so signup logs you straight in. In Authentication > URL Configuration, set the Site URL to wherever you host the app.

To use your own logo, replace `public/logo.svg` (it is also the favicon). To change the support address, edit `SUPPORT_EMAIL` in `src/lib/constants.js`.

## How access is enforced

All rules live in the database, so the interface cannot bypass them.

| Rule | Where |
|---|---|
| Users only see their own workplace's profiles, messages, likes, briefs and photos | RLS policies built on `my_workplace_id()` |
| Supervisors channel: supervisors and managers. Management channel: managers only | `can_access_channel()`, used by the message, like and storage policies |
| Only managers change roles, and a workplace always keeps at least one manager | `set_member_role()` RPC; `role` and `workplace_id` can't be updated directly (column grants) |
| The join code is visible only to managers | the `join_code` column isn't granted to users; read through `get_join_code()` |
| Create, join and leave a workplace | `create_workplace()`, `join_workplace()`, `leave_workplace()` RPCs |
| The only manager can't leave while others remain | `leave_workplace()`. If they are the last person left, the workplace is deleted |
| Message photos are private | `message-images` bucket, path `<workplace>/<channel>/<file>`, served through signed URLs |
| Each user's brief only uses channels they can read | the Edge Function queries with the caller's token, so RLS applies |

## Project layout

```
src/
  App.jsx                 routing: signed out → login, no workplace → setup, else the app
  context/AuthContext.jsx session, profile, workplace (with live role updates)
  components/             Layout (sidebar + mobile drawer), WelcomeDialog, ImageViewer, RoleBadge, Avatar…
  pages/                  Login, Signup, WorkplaceSetup, Home (shift brief), Chat (all channels)
  pages/settings/         Profile, Notifications, Account, Help, ManageTeam
supabase/
  migrations/             schema + RLS + RPCs + storage + realtime
  functions/shift-brief/  Edge Function that calls Claude
```
