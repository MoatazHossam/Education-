#!/usr/bin/env bash
# Proves a backup is restorable: restores it into a scratch database, runs
# sanity checks, prints row counts, then drops the scratch database.
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

psql "$url" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
SELECT name AS applied_migration FROM kysely_migration ORDER BY name;
SELECT 'organizations' AS table, count(*) FROM organizations
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'scopes', count(*) FROM scopes
UNION ALL SELECT 'scope_items', count(*) FROM scope_items
UNION ALL SELECT 'subscriptions', count(*) FROM subscriptions
UNION ALL SELECT 'invoices', count(*) FROM invoices
UNION ALL SELECT 'catalog_materials', count(*) FROM catalog_materials
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;
-- Row-level security must survive the restore.
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
WHERE relname IN ('scopes', 'scope_items', 'subscriptions', 'invoices') ORDER BY relname;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname IN ('scopes','scope_items','invoices','subscriptions') AND NOT (relrowsecurity AND relforcerowsecurity)) THEN
    RAISE EXCEPTION 'row-level security missing after restore';
  END IF;
  IF (SELECT count(*) FROM organizations) <> (SELECT count(*) FROM subscriptions) THEN
    RAISE EXCEPTION 'every organization must have a subscription row';
  END IF;
END $$;
SQL
echo "backup verified: $DUMP"
