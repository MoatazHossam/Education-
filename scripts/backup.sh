#!/usr/bin/env bash
# Logical backup of the application database.
#
#   BACKUP_DATABASE_URL=postgres://curriculum_backup:***@host:5432/curriculum_scope \
#   BACKUP_DIR=/var/backups/curriculum-scope RETENTION_DAYS=14 scripts/backup.sh
#
# Connect as the read-only backup role (BYPASSRLS + pg_read_all_data): tenant
# tables FORCE row-level security, so the schema owner cannot dump them.
# Optional: BACKUP_GPG_RECIPIENT=<key id> encrypts the dump at rest.
set -euo pipefail
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
umask 077

ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/curriculum-scope-$ts.dump"
pg_dump --format=custom --compress=6 --file="$file.partial" "$BACKUP_DATABASE_URL"
mv "$file.partial" "$file"

if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$file.gpg" "$file"
  rm -f "$file"
  file="$file.gpg"
fi
sha256sum "$file" > "$file.sha256"

# Retention: remove local dumps older than RETENTION_DAYS (off-site copies follow their own policy).
find "$BACKUP_DIR" -maxdepth 1 -name 'curriculum-scope-*.dump*' -mtime +"$RETENTION_DAYS" -delete

echo "backup written: $file ($(du -h "$file" | cut -f1))"
