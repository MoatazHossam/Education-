#!/usr/bin/env bash
# Restart (or upgrade) the production app instances one at a time, so one keeps
# serving while the other restarts. Run from the project directory on the host.
#
#   scripts/rolling-restart.sh            restart app, then app2, then the worker
#   scripts/rolling-restart.sh --build    rebuild the image and apply migrations first
#
# ENV_FILE (default .env.production) selects the environment file. Migrations
# must work with the previous release still running (DEPLOYMENT_GUIDE §4).
set -euo pipefail
ENV_FILE="${ENV_FILE:-.env.production}"
dc() { docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }

# Ready = /readyz answers 200 inside the container: database reachable, schema current.
wait_ready() {
  for _ in $(seq 1 90); do
    if dc exec -T "$1" node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "$1 is not ready after 3 minutes; stopping here so the other instance keeps serving." >&2
  exit 1
}

if [ "${1:-}" = "--build" ]; then
  dc build migrate
  dc run --rm migrate
fi

for svc in app app2; do
  echo "Restarting $svc (it drains for 5 s first; the other instance serves meanwhile)"
  dc up -d --no-deps --force-recreate "$svc"
  wait_ready "$svc"
  # Caddy checks readiness every 2 s; give it two checks to put the instance back.
  sleep 4
done
dc up -d --no-deps --force-recreate worker
echo "Done: app, app2 and worker restarted."
