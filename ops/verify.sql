-- Checks a Curriculum Scope database: the live one when a backup is taken, the restored one
-- after a restore or a backup test. Run as the backup role or a superuser:
--   psql -v ON_ERROR_STOP=1 -At -F '|' -f ops/verify.sql
-- Output lines: migrations|<count>|<last>, forced_rls_tables|<count>, rows|<table>|<count>.
-- Stops with an error when row-level security is on but not forced on a table, or an
-- organization has no subscription row.
\set QUIET on
SELECT 'migrations', count(*), max(name) FROM kysely_migration;
SELECT 'forced_rls_tables', count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'row-level security is on but not forced on a table';
  END IF;
  IF (SELECT count(*) FROM organizations) <> (SELECT count(*) FROM subscriptions) THEN
    RAISE EXCEPTION 'every organization must have a subscription row';
  END IF;
END $$;
SELECT 'rows', table_name,
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
