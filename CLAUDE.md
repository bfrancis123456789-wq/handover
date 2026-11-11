# Handover

Mobile-first workplace chat for shift teams (hospitality, retail, hotels): role-based channels, an AI shift brief, push notifications. Tagline: "Keep every shift on the same page".

## Stack

- React 19 + Vite + Tailwind CSS 4 (tokens in `src/index.css`), React Router, plain JavaScript.
- Supabase: Auth, Postgres, Storage, Realtime, Edge Functions (Deno, TypeScript).
- `shift-brief` calls Claude (`claude-haiku-5-5`) with structured JSON output; `send-push` sends Web Push (VAPID).
- Secrets (Anthropic key, VAPID private key, webhook secret) live only in Edge Function secrets or Vault. Never put them in `VITE_*` variables.

## Access rules live in Postgres

- Every access rule is enforced with RLS policies, column grants and SQL helper functions. The UI may hide things, but never enforce something only in the UI.
- One source of truth for channel access: `role_can_access(role, channel)`. Built on it: `can_access_channel()`, `can_post_in_channel()` (Announcements: supervisors and managers only), `my_channels()`, `unread_counts()`, `push_recipients()`.
- Edge Functions never hardcode access. `shift-brief` queries with the caller's token so RLS applies, and reads the channel list from `my_channels()`. `send-push` uses the service role only to call `push_recipients()`.
- `role` and `workplace_id` change only through RPCs (`create_workplace`, `join_workplace`, `set_member_role`, `remove_member`, `leave_workplace`). Users can't update those columns directly.
- `src/lib/constants.js` (`CHANNELS`, `roles`, `postRoles`) mirrors the rules for display only: menu items, read-only notes. Change it in the same commit as the SQL.
- Schema changes go in a new file in `supabase/migrations/`. Don't edit migrations that may already be deployed. Prove the full set with `supabase db reset`.

## Tests are part of every feature

- Every feature adds checks to `e2e/walkthrough.cjs` (real browsers, several users at once).
- Anything touching data access also adds checks to `e2e/security.sql` (acts as each user directly against the database).
- Both suites must pass before committing. Fix the cause, not the test, unless the test was wrong.
- Local stand-ins: `e2e/fake-anthropic.mjs` (Claude API) and `e2e/fake-push.mjs` (push service; tests decrypt pushes to check recipients).

```bash
supabase start
node e2e/fake-anthropic.mjs & node e2e/fake-push.mjs &
npx vite --config e2e/vite.e2e.config.js     # app on :5173, proxies to the local stack
node e2e/walkthrough.cjs
docker exec -i supabase_db_handover psql -U postgres < e2e/security.sql
```

The README has the full setup, including how to run the Edge Functions locally.

## UI copy

- Plain, friendly and short, written for busy staff on a phone mid-shift. British English ("summarise", "colour").
- Name things the way staff do (channels, shifts, rota), never by how the system is built.
- Buttons say exactly what happens ("Turn on notifications", "Leave Workplace"), and a success note confirms it.
- Errors say what went wrong and what to do next. No apologies, no error codes, no jargon.
- Destructive actions (delete, remove, leave, reset code) get an inline confirm step. Never `window.confirm`.

## Layout and design

- Mobile-first: design at about 390px wide first, then widen. No sideways scrolling at any width.
- Respect safe-area insets (`env(safe-area-inset-*)`) on headers, the post box and full-screen views.
- Touch targets at least 40px, and every control has a visible focus state and an accessible label.
- Brand: navy sidebar, teal (`teal-brand` #20b2aa) buttons, light grey canvas (#F4F5F7), white rounded cards, Inter. Role badges: Manager gold, Supervisor teal, Team Member grey.
- Logo files are in `public/brand/`; the app uses `public/logo.png`.

## Out of scope for now

Incident logs, checklists, pinned messages, weekly reports, payments, native apps.
