# Handover

Mobile-first workplace chat for shift teams (hospitality, retail, hotels): role-based channels, an AI shift brief, push notifications. Tagline: "Keep every shift on the same page".

## Stack

- React 19 + Vite + Tailwind CSS 4 (tokens in `src/index.css`), React Router, plain JavaScript.
- Supabase: Auth, Postgres, Storage, Realtime, Edge Functions (Deno, TypeScript).
- `shift-brief` calls Claude (`claude-haiku-5-5`) with structured JSON output; `send-push` sends Web Push (VAPID).
- Secrets (Anthropic key, VAPID private key, webhook secret) live only in Edge Function secrets or Vault. Never put them in `VITE_*` variables.

## Access rules live in Postgres

- Every access rule is enforced with RLS policies, column grants and SQL helper functions. The UI may hide things, but never enforce something only in the UI.
- One source of truth for channel access: `role_can_access(role, channel)`. Built on it: `can_access_channel()`, `can_post_in_channel()` (Announcements: supervisors and managers only), `my_channels()`, `unread_counts()`, `push_recipients()`, and the `issues` policy.
- Tracked issues: only `shift-brief` writes AI updates, through `apply_brief_updates()` (service role; validates sources and visibility). People use `resolve_issue()`, `reopen_issue()`, `assign_issue()`. No direct table writes.
- Edge Functions never hardcode access. `shift-brief` reads with the caller's token so RLS applies, gets the channel list from `my_channels()`, and uses the service role only for `apply_brief_updates()`. `send-push` uses the service role only to call `push_recipients()`.
- Keep the brief's cost controls: no Claude call when nothing new was posted, a one-minute cooldown per person, and capped prompt size.
- Every Edge Function uses `_shared/cors.ts` (only `ALLOWED_ORIGINS`; never `*`) and `_shared/sentry.ts` (`serve()` and `report()`; never send message text, emails or tokens).
- `role` and `workplace_id` change only through RPCs (`create_workplace`, `join_workplace`, `set_member_role`, `remove_member`, `leave_workplace`). Users can't update those columns directly.
- `src/lib/constants.js` (`CHANNELS`, `roles`, `postRoles`) mirrors the rules for display only: menu items, read-only notes. Change it in the same commit as the SQL.
- Schema changes go in a new file in `supabase/migrations/`. Don't edit migrations that may already be deployed. Prove the full set with `supabase db reset`.

## Tests are part of every feature

- Every feature adds checks to `e2e/walkthrough.cjs` (real browsers, several users at once).
- Anything touching data access also adds checks to `e2e/security.sql` (acts as each user directly against the database).
- Both suites must pass before committing. Fix the cause, not the test, unless the test was wrong.
- Run both with `supabase start` then `npm run test:e2e` (`e2e/run-ci.sh`, also used by GitHub Actions). It starts stand-ins for Claude, the push service and Sentry, so no real keys are needed. Failures save screenshots to `e2e/out`.

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
