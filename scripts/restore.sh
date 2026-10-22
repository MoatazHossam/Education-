#!/usr/bin/env bash
# Restores a backup into a NEW database (never over the live one).
#
#   RESTORE_ADMIN_URL=postgres://postgres:***@host:5432/postgres \
#   DB_OWNER_USER=curriculum_owner scripts/restore.sh backups/curriculum-scope-<ts>.dump curriculum_scope_restored
#
# Runs as the database superuser: data is loaded with row-level security
# bypassed, and the dump's own ownership/grants (owner role, app role) are kept,
# so the target cluster must already have those roles (see deploy/postgres-init).
# To go live, point DATABASE_URL/MIGRATION_DATABASE_URL at the restored database
# (or rename databases during a maintenance window) and restart app + worker.
set -euo pipefail
: "${RESTORE_ADMIN_URL:?set RESTORE_ADMIN_URL (superuser connection to the maintenance database)}"
DUMP="${1:?usage: restore.sh <dump file> <new database name>}"
TARGET="${2:?usage: restore.sh <dump file> <new database name>}"
OWNER="${DB_OWNER_USER:-curriculum_owner}"
[[ "$TARGET" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "invalid database name: $TARGET" >&2; exit 2; }

if [[ -f "$DUMP.sha256" ]]; then
  (cd "$(dirname "$DUMP")" && sha256sum --check --status "$(basename "$DUMP").sha256") || { echo "checksum mismatch for $DUMP" >&2; exit 3; }
fi
if [[ "$DUMP" == *.gpg ]]; then
  plain="$(mktemp)"
  trap 'rm -f "$plain"' EXIT
  gpg --batch --yes --decrypt --output "$plain" "$DUMP"
  DUMP="$plain"
fi

exists="$(psql "$RESTORE_ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'")"
[[ -z "$exists" ]] || { echo "database $TARGET already exists; choose a new name" >&2; exit 4; }
psql "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TARGET\" OWNER \"$OWNER\""

target_url="$(python3 -c 'import sys,urllib.parse as u; p=u.urlparse(sys.argv[1]); print(p._replace(path="/"+sys.argv[2]).geturl())' "$RESTORE_ADMIN_URL" "$TARGET")"
pg_restore --exit-on-error --dbname="$target_url" "$DUMP"
echo "restored into database $TARGET"
