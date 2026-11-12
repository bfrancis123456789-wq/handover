# Deploying Handover

Two Supabase projects (staging and production), one Cloudflare Pages project, and GitHub Actions in between. Nothing deploys unless every test passes.

```
pull request ──► tests ──► preview site  https://pr-<n>.<project>.pages.dev   (staging data)
merge to main ──► tests ──► STAGING: migrations, functions, https://staging.<project>.pages.dev, smoke check
                         └► PRODUCTION (after approval): encrypted backup, migrations, functions, site, smoke check
```

## 1. Accounts and keys (from the founder)

| What | Where it goes |
|---|---|
| Domain, e.g. `app.yourdomain.com.au`, and access to its DNS | Cloudflare Pages custom domain; SPF/DKIM/DMARC records for email |
| Cloudflare account | Create a Pages project with **Direct Upload** (no Git connection; GitHub Actions uploads). Create an API token with *Cloudflare Pages: Edit*. |
| Supabase organisation on a paid plan | **Production** project in Sydney (ap-southeast-2). **Staging** project on the free plan, also in Sydney. |
| Supabase access token | Account → Access Tokens (lets GitHub run migrations) |
| Email provider (Resend or Postmark) | Verify the domain, then put its SMTP details in **both** Supabase projects |
| Anthropic API key, with a monthly spend limit set | Edge Function secret in each project (staging can use a separate, low-limit key) |
| Sentry: one front-end project and one Edge Functions project | DSNs below; alert rules in `docs/monitoring.md` |
| The founder's admin email | `platform_admins` (step 5) |

Never paste keys into chat or commit them. They go into GitHub, Cloudflare or Supabase settings.

## 2. GitHub settings

Create two **environments** (Settings → Environments): `staging` and `production`. On `production`, add yourself under **Required reviewers**, so every production release waits for your approval.

**Repository secrets** (shared):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Pages: Edit token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `SUPABASE_ACCESS_TOKEN` | Supabase access token |

**Environment secrets** (set separately in `staging` and `production`):

| Secret | Value |
|---|---|
| `SUPABASE_DB_PASSWORD` | That project's database password |
| `BACKUP_PASSPHRASE` | (`production` only) a long random passphrase for backups. Store it in your password manager: without it, backups can't be opened. |

**Environment variables** (Settings → Environments → Variables; these are not secret):

| Variable | Example |
|---|---|
| `SUPABASE_PROJECT_REF` | `abcd1234efgh5678` |
| `SUPABASE_URL` | `https://abcd1234efgh5678.supabase.co` |
| `SUPABASE_ANON_KEY` | the project's anon (public) key |
| `VAPID_PUBLIC_KEY` | that project's public VAPID key |
| `SENTRY_DSN_FRONTEND` | front-end Sentry DSN |
| `SITE_URL` | staging: `https://staging.<project>.pages.dev`; production: `https://app.yourdomain.com.au` |

**Repository variables:** `CF_PAGES_PROJECT` is the Pages project name. Set `DEPLOY_ENABLED` to `true` once everything on this page is in place. Until then, GitHub only runs the tests.

## 3. Each Supabase project (staging, then production)

1. **Edge Function secrets.** Generate VAPID keys per project with `npx web-push generate-vapid-keys`, and a long random `PUSH_WEBHOOK_SECRET`.
   ```bash
   supabase link --project-ref <ref>
   supabase secrets set ANTHROPIC_API_KEY=... SENTRY_DSN=<functions DSN> SENTRY_ENVIRONMENT=<staging|production> \
     VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:support@yourdomain.com.au PUSH_WEBHOOK_SECRET=... \
     ALLOWED_ORIGINS=<see below> DEMO_PASSWORD=<shared demo password>
   ```
   - Production: `ALLOWED_ORIGINS=https://app.yourdomain.com.au`
   - Staging: `ALLOWED_ORIGINS=https://staging.<project>.pages.dev,https://*.<project>.pages.dev` (the wildcard covers pull request previews)
2. **Push delivery.** In the SQL editor (use the same secret as `PUSH_WEBHOOK_SECRET`):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-push', 'push_function_url');
   select vault.create_secret('<PUSH_WEBHOOK_SECRET>', 'push_webhook_secret');
   ```
3. **Authentication settings:**
   - URL Configuration: Site URL = `SITE_URL`; Redirect URLs = `SITE_URL/**` (on staging also `https://*.<project>.pages.dev/**`).
   - SMTP Settings: your email provider.
   - Email provider: minimum password length **8**; turn on leaked-password protection; decide on email confirmation.
   - Multi-factor: make sure authenticator-app (TOTP) MFA is on (it is by default). The founder dashboard needs it.
   - Attack protection: add CAPTCHA (Cloudflare Turnstile) for signup and password reset.
4. **Backups (production):** daily backups come with the paid plan; add point-in-time recovery if budget allows.

The first push to `main` runs the migrations and deploys the functions to staging, then production.

## 4. Cloudflare Pages

- Add the custom domain to the Pages project (production deploys from the `main` branch name).
- Routing: there is no `404.html`, so Pages serves the app for every path (single-page app mode). No rewrite rule is needed.
- Headers: `public/_headers` sets the Content-Security-Policy, HSTS and caching. `e2e/csp-check.cjs` proves in CI that the policy doesn't break the app. If you put Supabase or Sentry on a custom domain, add it to the policy.

## 5. After the first production deploy

1. **Make the founder an admin.** They sign up in the app first, then in the production SQL editor:
   ```sql
   insert into public.platform_admins (user_id) select id from auth.users where email = 'founder@yourdomain.com.au';
   ```
   On their first visit to `/admin` they set up an authenticator app.
2. **Create the demo.** From a laptop, with the production service role key in the environment (never committed):
   ```bash
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run demo:reset
   ```
   After that, the founder can reset it from the dashboard.
3. Run `docs/pilot-dry-run.md` together.

## Migrations: staging first, always

- Every schema change is a new file in `supabase/migrations/`. Never edit one that has been deployed.
- Merging to `main` applies it to **staging** first. Production only starts if staging succeeded, and only after approval.
- To try a migration on staging before merging, run the workflow manually (Actions → CI and deploy → Run workflow) on the branch. Pull request previews use staging's current schema, so a preview that needs a new migration won't fully work until it's on staging.

## Restoring a production backup

Each production deploy uploads `production-backup-<run id>` (kept 30 days) to that workflow run. To restore:

```bash
gpg --decrypt backup-<run id>.tar.gz.gpg > backup.tar.gz   # asks for BACKUP_PASSPHRASE
tar -xzf backup.tar.gz                                       # roles.sql, schema.sql, data.sql
psql "<connection string of a NEW or empty project>" -f roles.sql -f schema.sql -f data.sql
```

Restore into a fresh project first, check it, then switch over. For "undo the last few minutes", Supabase's own point-in-time recovery is faster.
