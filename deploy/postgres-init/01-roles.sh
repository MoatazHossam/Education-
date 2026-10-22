#!/bin/sh
# Runs once when the Postgres volume is first initialised (docker-entrypoint-initdb.d).
# Creates a schema-owner role (migrations only) and a least-privilege runtime role
# without SUPERUSER/BYPASSRLS, so Row-Level Security applies to the application.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE ${DB_OWNER_USER} LOGIN PASSWORD '${DB_OWNER_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
CREATE ROLE ${DB_APP_USER} LOGIN PASSWORD '${DB_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
-- Read-only backup role: tenant tables FORCE row-level security, so even the
-- schema owner cannot pg_dump them; this role bypasses RLS but cannot write.
CREATE ROLE ${DB_BACKUP_USER} LOGIN PASSWORD '${DB_BACKUP_PASSWORD}' NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB;
GRANT pg_read_all_data TO ${DB_BACKUP_USER};
CREATE DATABASE ${DB_NAME} OWNER ${DB_OWNER_USER};
REVOKE ALL ON DATABASE ${DB_NAME} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_APP_USER}, ${DB_BACKUP_USER};
SQL
