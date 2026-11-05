#!/usr/bin/env bash
# Rollback drill (docs/DEPLOYMENT_GUIDE.md §4.3, production finding I-3): shows that an installation
# goes back to the previous release after a release that added a migration, by both documented paths.
#
#   scripts/rollback-drill.sh          run it (about 10 minutes; needs Docker and ports 80 and 443 free)
#   scripts/rollback-drill.sh --keep   leave the drill's containers, volumes and images afterwards
#   DOCKER_BUILD_ARGS                  extra `docker build` arguments, as for scripts/ci-local.sh (a proxy)
#
# It runs as its own Compose project (midad-drill) with throwaway settings and secrets, so an
# installation on the same machine is not touched.
#   1. Builds release N (this checkout) and release N+1: the same image plus one migration that
#      expands the schema (a new table and a new column), as the expand/contract rule allows.
#   2. Starts N+1 with ops/start.sh: the migration is applied.
#   3. Rolls back to N with ops/start.sh (APP_IMAGE_TAG): N's migrate must succeed on the newer database.
#   4. Goes forward to N+1 with ops/start.sh, then back to N with scripts/rolling-restart.sh.
# After each step both app instances must answer /readyz with 200 and run the expected image.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PROJECT=midad-drill
N=midad:drill-n
N1=midad:drill-n1
KEEP=0
[[ ${1:-} == --keep ]] && KEEP=1

WORK=$(mktemp -d)
ENV_FILE="$WORK/.env.drill"
LOG="$WORK/drill.log"
step() { printf '\n== %s\n' "$*"; }
fail() {
  printf 'DRILL FAILED: %s\n' "$*" >&2
  [[ -s $LOG ]] && { printf -- '-- last lines of %s:\n' "$LOG" >&2; tail -15 "$LOG" >&2; }
  KEEP=1 # leave everything for a look
  exit 1
}
dc() { docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
cleanup() {
  if ((KEEP)); then
    printf '\nKept: project %s (settings in %s), images %s and %s.\n' "$PROJECT" "$ENV_FILE" "$N" "$N1"
    return
  fi
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm "$N1" "$N" >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT

secret() { head -c "$1" /dev/urandom | base64 | tr -d '\n/+=' | head -c "${2:-40}"; }
cat >"$ENV_FILE" <<EOF
COMPOSE_PROJECT_NAME=$PROJECT
APP_IMAGE_TAG=drill-n1
NODE_ENV=production
APP_URL=https://localhost
DOMAIN=localhost
ACME_EMAIL=drill@example.invalid
POSTGRES_SUPERUSER_PASSWORD=$(secret 32)
DB_NAME=midad
DB_OWNER_USER=midad_owner
DB_OWNER_PASSWORD=$(secret 32)
DB_APP_USER=midad_app
DB_APP_PASSWORD=$(secret 32)
DB_SYSTEM_USER=midad_system
DB_SYSTEM_PASSWORD=$(secret 32)
DB_BACKUP_USER=midad_backup
DB_BACKUP_PASSWORD=$(secret 32)
SESSION_SECRET=$(secret 48 64)
DATA_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)
EMAIL_TRANSPORT=smtp
SMTP_URL=smtp://127.0.0.1:2525
EMAIL_FROM=Midad drill <no-reply@localhost>
BILLING_PROVIDER=disabled
FILE_SCAN=off
EOF
chmod 600 "$ENV_FILE"
set_tag() { sed -i "s/^APP_IMAGE_TAG=.*/APP_IMAGE_TAG=$1/" "$ENV_FILE"; }

# Both app instances ready (database reachable, this release's migrations applied) and running the image.
check() {
  local svc image i
  for svc in app app2; do
    for i in $(seq 1 90); do
      dc exec -T "$svc" node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break
      ((i == 90)) && fail "$svc is not ready after 3 minutes"
      sleep 2
    done
    image=$(docker inspect --format '{{.Config.Image}}' "$(dc ps -q "$svc")")
    [[ $image == "$1" ]] || fail "$svc runs $image, expected $1"
    printf '  %s: /readyz 200, image %s\n' "$svc" "$image"
  done
}
applied() { dc exec -T postgres psql -U postgres -d midad -Atc "SELECT count(*) FROM kysely_migration WHERE name = '9000_rollback_drill'"; }

step "Building release N ($N) from this checkout"
# shellcheck disable=SC2086 # DOCKER_BUILD_ARGS holds several arguments
docker build -q ${DOCKER_BUILD_ARGS:-} -t "$N" . >/dev/null

step "Building release N+1 ($N1): release N plus migration 9000_rollback_drill"
mkdir -p "$WORK/n1"
cat >"$WORK/n1/9000_rollback_drill.js" <<'EOF'
import { sql } from 'kysely';
// Rollback drill (scripts/rollback-drill.sh): an expanding change, which an older release ignores.
export async function up(db) {
  await sql.raw('CREATE TABLE rollback_drill (id int PRIMARY KEY); ALTER TABLE organizations ADD COLUMN rollback_drill_note text').execute(db);
}
export async function down(db) {
  await sql.raw('ALTER TABLE organizations DROP COLUMN rollback_drill_note; DROP TABLE rollback_drill').execute(db);
}
EOF
cat >"$WORK/n1/Dockerfile" <<EOF
FROM $N
COPY --chown=node:node 9000_rollback_drill.js dist/db/migrations/
RUN sed -i "1i import * as m9000 from './migrations/9000_rollback_drill.js';" dist/db/migrator.js \\
 && sed -i "s/^const MIGRATIONS = {/&\n    '9000_rollback_drill': m9000,/" dist/db/migrator.js \\
 && grep -q "'9000_rollback_drill': m9000" dist/db/migrator.js
EOF
docker build -q -t "$N1" "$WORK/n1" >/dev/null

step "Release N+1 with ops/start.sh"
dc down -v --remove-orphans >/dev/null 2>&1 || true
ops/start.sh --env prod --env-file "$ENV_FILE" --yes >>"$LOG" 2>&1 || fail "ops/start.sh failed"
check "$N1"
[[ $(applied) == 1 ]] || fail "migration 9000_rollback_drill was not applied"
echo "  migration 9000_rollback_drill applied"

step "Rollback to N with ops/start.sh (the path of finding I-3)"
set_tag drill-n
ops/start.sh --env prod --env-file "$ENV_FILE" --yes >>"$LOG" 2>&1 || fail "ops/start.sh failed"
dc logs --no-log-prefix migrate | grep -q "Database is ahead of this release (rollback): 9000_rollback_drill stay applied" ||
  fail "release N's migrate did not report the newer database: $(dc logs --no-log-prefix migrate | tail -5)"
echo "  migrate (release N): $(dc logs --no-log-prefix migrate | grep 'Database is ahead')"
check "$N"
[[ $(applied) == 1 ]] || fail "migration 9000_rollback_drill is no longer recorded"

step "Forward to N+1 with ops/start.sh"
set_tag drill-n1
ops/start.sh --env prod --env-file "$ENV_FILE" --yes >>"$LOG" 2>&1 || fail "ops/start.sh failed"
check "$N1"

step "Rollback to N with scripts/rolling-restart.sh"
set_tag drill-n
ENV_FILE="$ENV_FILE" scripts/rolling-restart.sh >>"$LOG" 2>&1 || fail "scripts/rolling-restart.sh failed"
check "$N"

printf '\nDRILL PASSED: release N runs on the database release N+1 migrated, by both rollback paths.\n'
