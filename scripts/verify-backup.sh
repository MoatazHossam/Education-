#!/usr/bin/env bash
# Proves a backup is restorable: restores it into a scratch database, runs
# sanity checks (ops/verify.sql), prints row counts, then drops the scratch database.
# For backups made by ops/backup.sh (bundled database, only Docker needed), use ops/restore.sh --only-verify.
#
#   RESTORE_ADMIN_URL=postgres://postgres:***@host:5432/postgres scripts/verify-backup.sh backups/curriculum-scope-<ts>.dump
set -euo pipefail
: "${RESTORE_ADMIN_URL:?set RESTORE_ADMIN_URL}"
DUMP="${1:?usage: verify-backup.sh <dump file>}"
SCRATCH="curriculum_verify_$(date -u +%Y%m%d%H%M%S)"
here="$(cd "$(dirname "$0")" && pwd)"

cleanup() { psql "$RESTORE_ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"$here/restore.sh" "$DUMP" "$SCRATCH"
url="$(python3 -c 'import sys,urllib.parse as u; p=u.urlparse(sys.argv[1]); print(p._replace(path="/"+sys.argv[2]).geturl())' "$RESTORE_ADMIN_URL" "$SCRATCH")"

# Migrations, row-level security forced on every table that has it, invariants, row counts.
psql "$url" -v ON_ERROR_STOP=1 -At -F '|' -f "$here/../ops/verify.sql"
echo "backup verified: $DUMP"
