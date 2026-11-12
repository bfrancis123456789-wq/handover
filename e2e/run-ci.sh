#!/usr/bin/env bash
# Runs the security suite and the end-to-end walkthrough against a running local
# Supabase stack. Used by CI (.github/workflows/ci.yml) and on your own machine.
#   supabase start            # first
#   bash e2e/run-ci.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${OUT_DIR:-e2e/out}"
LOGS="$OUT/logs"
mkdir -p "$LOGS"

# Local stack details (API URL and keys).
eval "$(supabase status -o env | sed -n 's/^\(API_URL\|ANON_KEY\|SERVICE_ROLE_KEY\)=/export SB_\1=/p')"
GATEWAY=$(docker network inspect supabase_network_handover --format '{{(index .IPAM.Config 0).Gateway}}')

# Throwaway push keys for this run.
VAPID_JSON=$(npx --yes web-push@3.6.7 generate-vapid-keys --json)
VAPID_PUBLIC=$(node -e "console.log(JSON.parse(process.argv[1]).publicKey)" "$VAPID_JSON")
VAPID_PRIVATE=$(node -e "console.log(JSON.parse(process.argv[1]).privateKey)" "$VAPID_JSON")

cat > .env.e2e.local <<ENV
VITE_SUPABASE_URL=http://localhost:5173
VITE_SUPABASE_ANON_KEY=$SB_ANON_KEY
VITE_VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VITE_SENTRY_DSN=http://public@localhost:4030/1
VITE_SENTRY_ENVIRONMENT=test
ENV

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

node e2e/fake-anthropic.mjs > "$LOGS/fake-anthropic.log" 2>&1 & pids+=($!)
node e2e/fake-push.mjs > "$LOGS/fake-push.log" 2>&1 & pids+=($!)
node e2e/fake-sentry.mjs > "$LOGS/fake-sentry.log" 2>&1 & pids+=($!)

export SUPABASE_URL="$SB_API_URL" SUPABASE_ANON_KEY="$SB_ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY"
export ANTHROPIC_API_KEY=sk-ant-test ANTHROPIC_BASE_URL=http://127.0.0.1:4010
export SENTRY_DSN=http://public@127.0.0.1:4030/2 SENTRY_ENVIRONMENT=test
export PUSH_WEBHOOK_SECRET=local-push-secret VAPID_PUBLIC_KEY="$VAPID_PUBLIC" VAPID_PRIVATE_KEY="$VAPID_PRIVATE" VAPID_SUBJECT=mailto:test@example.com
export NO_PROXY="127.0.0.1,localhost,$GATEWAY" no_proxy="127.0.0.1,localhost,$GATEWAY"

start_fn() {
  FN_PORT="$2" FN_FILE="file://$PWD/supabase/functions/$1/index.ts" \
    deno run --node-modules-dir=none --no-config --allow-net --allow-env --allow-read --allow-sys e2e/serve-function.ts \
    > "$LOGS/$1.log" 2>&1 & pids+=($!)
}
start_fn shift-brief 8000
start_fn send-push 8001
start_fn delete-account 8002
start_fn reset-demo 8003

npx vite --mode e2e --config e2e/vite.e2e.config.js > "$LOGS/vite.log" 2>&1 & pids+=($!)

wait_for() {
  for _ in $(seq 1 120); do curl -s -o /dev/null "$1" && return 0; sleep 1; done
  echo "Timed out waiting for $1"; return 1
}
for url in http://localhost:5173 http://127.0.0.1:4010/__calls http://127.0.0.1:4020/__pushes http://127.0.0.1:4030/__events \
           http://127.0.0.1:8000 http://127.0.0.1:8001 http://127.0.0.1:8002 http://127.0.0.1:8003; do
  wait_for "$url"
done

echo "== Edge Function unit tests =="
deno test --node-modules-dir=none --no-config supabase/functions/_shared/

echo "== Security checks =="
docker exec -i supabase_db_handover psql -U postgres -qtA -v ON_ERROR_STOP=1 < e2e/security.sql | tee "$LOGS/security.txt"

echo "== End-to-end walkthrough =="
PUSH_FUNCTION_URL="http://$GATEWAY:8001" SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY" OUT_DIR="$OUT" node e2e/walkthrough.cjs

echo "== Production headers (Content-Security-Policy) =="
node e2e/csp-check.cjs
