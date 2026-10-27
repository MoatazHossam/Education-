#!/usr/bin/env bash
# Runs the same steps as .github/workflows/ci.yml on any machine with Docker and
# Node.js 22 — free, and independent of GitHub Actions availability.
#
#   scripts/ci-local.sh                 # all three jobs: checks, e2e, docker
#   CI_JOBS="checks" scripts/ci-local.sh
#
# Options (environment):
#   CI_PG_PORT               host port for the Postgres service container (default 5432)
#   CI_SKIP_BROWSER_INSTALL  set to 1 if Playwright's browsers are already installed
#   CI_E2E_BROWSERS          browsers for the journeys (default "chromium firefox webkit"; the
#                            accessibility tests run with Chromium)
#   DOCKER_BUILD_ARGS        extra `docker build` arguments (e.g. proxy settings)
#
# Run it from a clean checkout (e.g. `git clone --branch main …`) to mirror CI exactly.
set -uo pipefail

JOBS="${CI_JOBS:-checks e2e docker}"
PG_PORT="${CI_PG_PORT:-5432}"
PG_CONTAINER="ci-local-postgres-$$"
results=()
failed=0

step() {
  local name="$1"
  shift
  echo
  echo "=== $name"
  local start=$SECONDS
  if "$@"; then
    results+=("PASS  $name ($((SECONDS - start))s)")
  else
    results+=("FAIL  $name ($((SECONDS - start))s)")
    failed=1
  fi
}

cleanup() { docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)"
[[ "$node_major" == "22" ]] || { echo "Node.js 22 is required (found: $node_major)" >&2; exit 2; }

# Service container: same image and credentials as the workflow's `services.postgres`.
if [[ "$JOBS" == *checks* || "$JOBS" == *e2e* ]]; then
  docker run -d --name "$PG_CONTAINER" -e POSTGRES_PASSWORD=postgres -p "127.0.0.1:$PG_PORT:5432" \
    --health-cmd "pg_isready -U postgres" --health-interval 2s --health-timeout 5s --health-retries 20 \
    postgres:16-alpine >/dev/null || exit 2
  for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER")" == "healthy" ]] && break
    sleep 1
  done
  export TEST_PG_ADMIN_URL="postgres://postgres:postgres@localhost:$PG_PORT/postgres"
fi

step "npm ci" npm ci --no-audit --no-fund

if [[ "$JOBS" == *checks* ]]; then
  step "checks: lint" npm run lint
  step "checks: typecheck" npm run typecheck
  step "checks: unit and integration tests" npm test
  step "checks: dependency audit (production)" npm audit --omit=dev --audit-level=high
fi

if [[ "$JOBS" == *e2e* ]]; then
  E2E_BROWSERS="${CI_E2E_BROWSERS:-chromium firefox webkit}"
  if [[ -z "${CI_SKIP_BROWSER_INSTALL:-}" ]]; then
    # shellcheck disable=SC2086 # the browser list is intentionally word-split
    step "e2e: install browsers ($E2E_BROWSERS)" npx playwright install --with-deps $E2E_BROWSERS
  fi
  for browser in $E2E_BROWSERS; do
    if [[ "$browser" == chromium ]]; then
      step "e2e: Playwright journeys and accessibility (Chromium)" npm run test:e2e
    else
      step "e2e: Playwright journeys ($browser)" npm run "test:e2e:$browser"
    fi
  done
fi

if [[ "$JOBS" == *docker* ]]; then
  # shellcheck disable=SC2086 # DOCKER_BUILD_ARGS is intentionally word-split
  step "docker: build image" docker build ${DOCKER_BUILD_ARGS:-} -t curriculum-scope:ci .
  smoke() {
    local out
    out=$(docker run --rm -e NODE_ENV=production -e APP_URL=https://ci.example -e DATABASE_URL=postgres://x@localhost/x \
      -e SESSION_SECRET=ci-secret-ci-secret-ci-secret-ci-secret -e DATA_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
      -e EMAIL_TRANSPORT=smtp -e SMTP_URL=smtp://localhost -e BILLING_PROVIDER=sandbox -e SANDBOX_WEBHOOK_SECRET=0123456789abcdef \
      curriculum-scope:ci 2>&1)
    echo "$out" | grep -q "sandbox billing provider cannot be used in production"
  }
  step "docker: production configuration guard" smoke
fi

echo
echo "=== Summary ($(git rev-parse --short HEAD 2>/dev/null || echo 'no git'))"
printf '%s\n' "${results[@]}"
exit "$failed"
