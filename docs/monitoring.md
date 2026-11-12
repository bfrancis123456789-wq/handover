# Monitoring and alerts

Sentry receives errors from the app and the Edge Functions, plus one "transaction" per Edge Function call with its outcome (`ok`, or `internal_error` for a 5xx answer). No message text, names, emails or sign-in tokens are sent.

Set these rules up once in Sentry (Alerts → Create Alert). Send all of them by email to the founder and the developer on call.

## Front-end project

| Rule | Type | Settings |
|---|---|---|
| New problem | Issue alert | When **a new issue is created**, environment `production`, email immediately |
| Error spike | Metric alert | **Number of errors** in environment `production` **> 20 in 5 minutes** (critical), **> 10** (warning) |

## Edge Functions project

| Rule | Type | Settings |
|---|---|---|
| New problem | Issue alert | When **a new issue is created**, environment `production`, email immediately |
| Error spike | Metric alert | **Number of errors > 5 in 10 minutes** (critical) |
| Failure rate | Metric alert | Dataset **Transactions**, function **failure_rate()**, filter `transaction:[shift-brief, delete-account, reset-demo, send-push]`, environment `production`, over **15 minutes**: critical **> 10%**, warning **> 5%**. Under "Advanced", ignore windows with fewer than 10 transactions, so one failure at 3am isn't 100%. |
| AI outage | Issue alert | When an event's tag `function` equals `shift-brief` and the message contains `claude`, more than 3 times in 10 minutes |

Failure rate counts only real server failures (5xx), such as Claude being down or a database error. Refused requests (wrong origin, daily limit reached, not signed in) are not failures.

## Other things worth watching during the pilot

- **Founder dashboard** (`/admin`): weekly active staff, briefs viewed, push opt-in and AI cost per venue, plus feedback as it arrives.
- **Anthropic console:** monthly spend against the limit you set.
- **Supabase:** Reports → API and database health; Edge Function logs for anything Sentry flags.
- **Cloudflare:** Pages deployment history; roll back from there if a release misbehaves (the database stays as it is).
