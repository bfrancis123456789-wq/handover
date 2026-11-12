#!/usr/bin/env bash
# Quick check that a deployed site is up: the app, a deep link, and its headers.
#   bash scripts/smoke-check.sh https://app.yourdomain.com.au
set -euo pipefail
site="${1:?site URL}"
site="${site%/}"
fail() { echo "FAIL  $1"; exit 1; }
for i in $(seq 1 10); do curl -fsS -o /dev/null "$site/" && break; sleep 6; done
curl -fsS "$site/" | grep -q '<div id="root">' || fail "home page does not serve the app"
curl -fsS "$site/channels/general" | grep -q '<div id="root">' || fail "deep links do not serve the app"
curl -fsSI "$site/" | grep -qi '^content-security-policy:' || fail "security headers missing"
curl -fsS -o /dev/null "$site/manifest.webmanifest" || fail "web app manifest missing"
echo "PASS  $site is up, deep links work and security headers are set"
