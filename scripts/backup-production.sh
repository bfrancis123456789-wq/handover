#!/usr/bin/env bash
# Encrypted backup of the linked Supabase project (schema, roles and data),
# taken before every production deploy. Restore steps: docs/deploy.md.
#   BACKUP_PASSPHRASE=... bash scripts/backup-production.sh backup-name
set -euo pipefail
name="${1:?backup name}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
dir=$(mktemp -d)
supabase db dump --linked --role-only -f "$dir/roles.sql"
supabase db dump --linked -f "$dir/schema.sql"
supabase db dump --linked --data-only --use-copy -f "$dir/data.sql"
tar -czf "$dir/$name.tar.gz" -C "$dir" roles.sql schema.sql data.sql
gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_PASSPHRASE" -o "$name.tar.gz.gpg" "$dir/$name.tar.gz"
rm -rf "$dir"
echo "Encrypted backup written to $name.tar.gz.gpg ($(du -h "$name.tar.gz.gpg" | cut -f1))"
