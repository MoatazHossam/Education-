#!/usr/bin/env bash
# Curriculum Scope operations for Linux: start, stop, status, back up, restore and test a backup,
# for the development stack (docker-compose.yml + .env.docker) or production
# (+ docker-compose.prod.yml + .env.production). Needs only bash and Docker with Compose v2.
# Windows: the same commands as ops\*.bat (ops\cs.ps1). Guide: docs/DEPLOYMENT_GUIDE.md §8.
#
#   ops/cs.sh                       a menu
#   ops/cs.sh start | stop | status | backup | restore | verify | destinations   [options]
#   (ops/start.sh, ops/stop.sh, ops/status.sh, ops/backup.sh and ops/restore.sh run the same)
#
# Options
#   --env dev|prod      which installation (asked when missing)
#   --env-file FILE     another settings file than .env.docker / .env.production
#   --yes               no questions: saved choices and defaults (for cron); needs --env
#   backup:  --to folder,server,bucket|none   copies besides the backup folder (default: saved choice)
#            --no-encrypt                     leave the archive unencrypted (not with the settings file)
#   restore: --from local|folder|server|bucket   --file NAME   --only-verify (= verify)
#
# Backup copy settings (folder, server, bucket, encryption, retention) are kept in .env.backup,
# readable only by you. The passphrase is never saved there: it is asked, or read from
# CS_BACKUP_PASSPHRASE or the file named by BACKUP_PASSPHRASE_FILE.
set -euo pipefail
umask 077 # every file these scripts write (backups, checksums, settings) is readable by you only

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CONF="$ROOT/.env.backup"
RCLONE_IMAGE=rclone/rclone:1.71
PG_IMAGE=postgres:16-alpine
TOOL_IMAGE=caddy:2.10-alpine

CMD="" ENV_NAME="" ENV_FILE="" YES=0 TO="" FROM="" PICK="" NO_ENCRYPT=0 ONLY_VERIFY=0
FILES=() PROJECT="" MANAGED=0 NOENV=0 IMAGE="" LOCKDIR="" FAILED=()
CLEANUP=()

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
cleanup() {
  local p
  for p in "${CLEANUP[@]}"; do rm -rf -- "$p"; done
  [[ -n $LOCKDIR ]] && rm -rf -- "$LOCKDIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP # Ctrl+C or a closed terminal still removes the lock and unfinished files

usage() { sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while (($#)); do
  case $1 in
    start | stop | status | backup | restore | verify | destinations | menu) CMD=$1 ;;
    --env) ENV_NAME=${2:?--env needs dev or prod}; shift ;;
    --env-file) ENV_FILE=${2:?--env-file needs a file}; shift ;;
    --yes | -y) YES=1 ;;
    --to) TO=${2:?--to needs a list}; shift ;;
    --from) FROM=${2:?--from needs local, folder, server or bucket}; shift ;;
    --file) PICK=${2:?--file needs a name}; shift ;;
    --no-encrypt) NO_ENCRYPT=1 ;;
    --only-verify) ONLY_VERIFY=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option $1 (ops/cs.sh --help)" ;;
  esac
  shift
done

# ------------------------------------------------------------------ questions
tty_ok() { { : </dev/tty; } 2>/dev/null; }
ask() { # ask VAR "Question" [default]  (helpers' locals start with _ so they never hide the caller's variable)
  local _av=$1 _aq=$2 _ad=${3-} _aa
  if ((YES)); then printf -v "$_av" '%s' "$_ad"; return; fi
  tty_ok || die "no terminal to ask \"$_aq\"; run with --yes to use the saved choices"
  if [[ -n $_ad ]]; then printf '%s [%s]: ' "$_aq" "$_ad" >/dev/tty; else printf '%s: ' "$_aq" >/dev/tty; fi
  IFS= read -r _aa </dev/tty || _aa=""
  printf -v "$_av" '%s' "${_aa:-$_ad}"
}
ask_secret() { # ask_secret VAR "Question"
  local _sv=$1 _sa
  ((YES)) && die "$2 is needed, and --yes cannot ask for it (see BACKUP_PASSPHRASE_FILE in docs/DEPLOYMENT_GUIDE.md §8)"
  tty_ok || die "no terminal to ask for $2"
  printf '%s: ' "$2" >/dev/tty
  IFS= read -rs _sa </dev/tty || _sa=""
  printf '\n' >/dev/tty
  printf -v "$_sv" '%s' "$_sa"
}
confirm() { # confirm "Question" y|n
  local _ya
  ask _ya "$1 (y/n)" "${2:-n}"
  [[ $_ya =~ ^[Yy] ]]
}
choose() { # choose VAR "Title" default "option 1" "option 2"...
  local _cv=$1 _ct=$2 _cd=$3 _cn=1 _co _ca
  shift 3
  if ((YES)); then printf -v "$_cv" '%s' "$_cd"; return; fi
  tty_ok || die "no terminal to ask \"$_ct\""
  printf '%s\n' "$_ct" >/dev/tty
  for _co in "$@"; do printf '  %d) %s\n' "$_cn" "$_co" >/dev/tty; _cn=$((_cn + 1)); done
  while :; do
    ask _ca "Choose" "$_cd"
    [[ $_ca =~ ^[0-9]+$ ]] && ((_ca >= 1 && _ca <= $#)) && break
    say "Type a number from 1 to $#." >/dev/tty
  done
  printf -v "$_cv" '%s' "$_ca"
}

# ------------------------------------------------------------------ settings files
kv_get() { # kv_get FILE KEY: the value without surrounding quotes, or nothing
  [[ -f $1 ]] || return 0
  local line
  line=$(grep -E "^[[:space:]]*$2=" "$1" | tail -n 1 || true)
  [[ -n $line ]] || return 0
  line=${line#*=}
  line=${line%$'\r'}
  if [[ ${#line} -ge 2 && (($line == \"*\" && $line == *\") || ($line == \'*\' && $line == *\')) ]]; then line=${line:1:${#line}-2}; fi
  printf '%s' "$line"
}
kv_set() { # kv_set FILE KEY VALUE: replaces the line or appends it, keeping the file private
  local f=$1 tmp
  tmp=$(mktemp "$f.XXXXXX")
  if [[ -f $f ]] && grep -qE "^[[:space:]]*$2=" "$f"; then
    K=$2 V=$3 awk 'BEGIN { re = "^[[:space:]]*" ENVIRON["K"] "=" } $0 ~ re { if (!done) print ENVIRON["K"] "=" ENVIRON["V"]; done = 1; next } { print }' "$f" >"$tmp"
  else
    { [[ -f $f ]] && cat "$f"; printf '%s=%s\n' "$2" "$3"; } >"$tmp"
  fi
  if [[ -f $f ]]; then chmod --reference="$f" "$tmp"; else chmod 600 "$tmp"; fi
  mv -f "$tmp" "$f"
}
envget() { kv_get "$ENV_FILE" "$1"; }
conf() { kv_get "$CONF" "$1"; }
save() { kv_set "$CONF" "$1" "$2"; }

# ------------------------------------------------------------------ the installation
pick_env() { # pick_env [missing-ok]: a restore onto a new server may start without the settings file
  if [[ -z $ENV_NAME ]]; then
    ((YES)) && die "--yes needs --env dev or --env prod"
    local c def=1
    [[ -f .env.production && ! -f .env.docker ]] && def=2
    choose c "Which installation?" "$def" "Development (docker-compose.yml, .env.docker)" "Production (docker-compose.yml + docker-compose.prod.yml, .env.production)"
    [[ $c == 1 ]] && ENV_NAME=dev || ENV_NAME=prod
  fi
  case $ENV_NAME in
    dev) ENV_FILE=${ENV_FILE:-.env.docker}; FILES=(-f docker-compose.yml) ;;
    prod) ENV_FILE=${ENV_FILE:-.env.production}; FILES=(-f docker-compose.yml -f docker-compose.prod.yml) ;;
    *) die "--env must be dev or prod" ;;
  esac
  NOENV=0
  if [[ ! -f $ENV_FILE ]]; then
    [[ ${1-} == missing-ok ]] || die "$ENV_FILE not found: copy .env.docker.example to $ENV_FILE and fill it in (docs/DEPLOYMENT_GUIDE.md §3.2)"
    NOENV=1
  fi
  PROJECT=${COMPOSE_PROJECT_NAME:-$(envget COMPOSE_PROJECT_NAME)}
  PROJECT=${PROJECT:-curriculum-scope}
  MANAGED=0
  [[ -n $(envget DATABASE_URL) ]] && MANAGED=1
  IMAGE="curriculum-scope:$(envget APP_IMAGE_TAG)"
  [[ $IMAGE == curriculum-scope: ]] && IMAGE=curriculum-scope:local
  return 0
}
dc() { docker compose "${FILES[@]}" --env-file "$ENV_FILE" "$@"; }
scale_args() { ((MANAGED)) && printf -- '--scale\npostgres=0\n'; return 0; }
apps() { [[ $ENV_NAME == prod ]] && echo "app app2" || echo "app"; }
db_name() { # DB_NAME, or the database named in DATABASE_URL (managed database)
  local n
  n=$(envget DB_NAME)
  ((MANAGED)) && [[ -z $n ]] && n=$(envget DATABASE_URL | sed -E 's#^[^/]*//[^/]*/([^?]*).*#\1#')
  printf '%s' "$n"
}

check_env() {
  local k missing=() keys=(SESSION_SECRET DATA_ENCRYPTION_KEY)
  if ((MANAGED)); then keys+=(MIGRATION_DATABASE_URL); else keys+=(POSTGRES_SUPERUSER_PASSWORD DB_NAME DB_OWNER_USER DB_OWNER_PASSWORD DB_APP_USER DB_APP_PASSWORD DB_BACKUP_PASSWORD); fi
  [[ $ENV_NAME == prod ]] && keys+=(APP_URL DOMAIN ACME_EMAIL)
  for k in "${keys[@]}"; do [[ -n $(envget "$k") ]] || missing+=("$k"); done
  ((${#missing[@]} == 0)) || die "set these in $ENV_FILE first: ${missing[*]}"
  if [[ $ENV_NAME == prod ]]; then
    grep -qE '=change-me' "$ENV_FILE" && die "$ENV_FILE still has change-me values: replace every password (docs/DEPLOYMENT_GUIDE.md §3.2)"
    [[ $(envget APP_URL) == https://* ]] || die "APP_URL must start with https:// in production"
    local mode
    mode=$(stat -c %a "$ENV_FILE")
    if [[ $mode != 600 && $mode != 400 ]]; then
      warn "$ENV_FILE can be read by other users of this computer (mode $mode)"
      confirm "Make it readable by you only (chmod 600)?" y && chmod 600 "$ENV_FILE"
    fi
  fi
  return 0
}
running() { dc ps --status running --services 2>/dev/null | grep -qx "$1"; }
ready() { dc exec -T "$1" node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; }
wait_ready() {
  local i
  for i in $(seq 1 90); do
    if ready "$1"; then say "  $1 is ready"; return 0; fi
    sleep 2
  done
  warn "$1 is not ready after 3 minutes: see the logs of $1 (docker compose logs $1)"
  return 1
}
wait_postgres() {
  local i
  for i in $(seq 1 60); do
    dc exec -T postgres pg_isready -q >/dev/null 2>&1 && return 0
    sleep 2
  done
  die "the database did not start: see the postgres logs"
}
ensure_image() {
  docker image inspect "$IMAGE" >/dev/null 2>&1 && return 0
  [[ $IMAGE == curriculum-scope:local ]] || die "image $IMAGE not found (APP_IMAGE_TAG in $ENV_FILE)"
  step "Building the app image (needed once; a few minutes)"
  docker build -t "$IMAGE" "$ROOT"
}

# ------------------------------------------------------------------ start, stop, status
cmd_start() {
  pick_env
  check_env
  local args=(up -d) extra build=0
  mapfile -t extra < <(scale_args)
  args+=("${extra[@]}")
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    [[ $IMAGE == curriculum-scope:local ]] || die "image $IMAGE not found (APP_IMAGE_TAG in $ENV_FILE)"
    say "The app image is not built yet: it is built first (a few minutes)."
    build=1
  elif [[ $IMAGE == curriculum-scope:local ]] && confirm "Rebuild the app image first (after updating the code)?" n; then
    build=1
  fi
  if ((build)); then
    args+=(--build)
    # The image being replaced stays as :previous, for a rollback (docs/DEPLOYMENT_GUIDE.md §4).
    docker image inspect "$IMAGE" >/dev/null 2>&1 && docker tag "$IMAGE" curriculum-scope:previous
  fi
  step "Starting the $ENV_NAME installation ($PROJECT)"
  dc "${args[@]}"
  step "Waiting for the app"
  local s
  for s in $(apps); do wait_ready "$s" || true; done
  show_status
}

cmd_stop() {
  pick_env
  local c
  choose c "Stop how?" 1 "Stop (containers, data and settings kept; start again with start)" "Stop and remove the containers (data, settings and images kept)"
  step "Stopping the $ENV_NAME installation ($PROJECT)"
  if [[ $c == 1 ]]; then dc stop; else dc down --remove-orphans; fi
  say "Stopped. The database, files and certificates stay in Docker volumes: nothing was deleted."
}

show_status() {
  step "Status of the $ENV_NAME installation ($PROJECT)"
  dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
  local s
  for s in $(apps); do
    if ready "$s"; then say "  $s: ready"; else say "  $s: not ready"; fi
  done
  say "Address: $(envget APP_URL)"
}
cmd_status() { pick_env; show_status; }

# ------------------------------------------------------------------ backup folder, lock, passphrase
backup_dir() {
  local d
  d=$(conf BACKUP_DIR)
  d=${d:-$ROOT/backups}
  mkdir -p "$d"
  chmod 700 "$d" 2>/dev/null || true
  (cd "$d" && pwd)
}
lock() { # one backup or restore at a time; a lock left by a run that was killed is taken over
  local d=$1 pid
  LOCKDIR="$d/.lock"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    pid=$(cat "$LOCKDIR/pid" 2>/dev/null || true)
    if [[ $pid =~ ^[0-9]+$ ]] && { kill -0 "$pid" 2>/dev/null || [[ -e /proc/$pid ]]; }; then
      LOCKDIR=""; die "another backup or restore is running (process $pid): wait for it to finish"
    fi
    if [[ -z $pid && -n $(find "$LOCKDIR" -maxdepth 0 -mmin -5 2>/dev/null) ]]; then
      LOCKDIR=""; die "another backup or restore has just started: wait for it to finish (or remove $d/.lock if none is running)"
    fi
    warn "an earlier backup or restore stopped without cleaning up; what it left is removed"
    rm -rf -- "$LOCKDIR"
    mkdir "$LOCKDIR" || { LOCKDIR=""; die "cannot lock $d"; }
  fi
  echo $$ >"$LOCKDIR/pid"
  rm -rf -- "$d"/.work-* "$d"/.restore-* "$d"/*.partial # left by a run that was killed (it may hold decrypted data)
}
get_passphrase() { # get_passphrase VAR new|existing
  local _pv=$1 _pp _pq _pf
  if [[ -n ${CS_BACKUP_PASSPHRASE:-} ]]; then printf -v "$_pv" '%s' "$CS_BACKUP_PASSPHRASE"; return; fi
  _pf=$(conf BACKUP_PASSPHRASE_FILE)
  if [[ -n $_pf ]]; then
    [[ -r $_pf ]] || die "BACKUP_PASSPHRASE_FILE $_pf cannot be read"
    _pp=$(head -n 1 "$_pf")
    printf -v "$_pv" '%s' "${_pp%$'\r'}"
    return
  fi
  while :; do
    ask_secret _pp "Backup passphrase (12 characters or more; the backup cannot be opened without it)"
    if [[ $2 == new ]]; then
      ((${#_pp} >= 12)) || { say "Too short."; continue; }
      ask_secret _pq "Type it again"
      [[ $_pp == "$_pq" ]] || { say "They differ."; continue; }
    fi
    break
  done
  printf -v "$_pv" '%s' "$_pp"
}

# ------------------------------------------------------------------ copies: folder, server, bucket
dest_label() {
  case $1 in
    folder) local f; f=$(conf BACKUP_FOLDER); echo "A folder or USB drive${f:+: $f}" ;;
    server) local h; h=$(conf BACKUP_SERVER_HOST); echo "Another server (SFTP)${h:+: $(conf BACKUP_SERVER_USER)@$h:$(conf BACKUP_SERVER_PATH)}" ;;
    bucket) local b e; b=$(conf BACKUP_BUCKET_NAME); e=$(conf BACKUP_BUCKET_ENDPOINT); echo "A storage bucket (S3)${b:+: $b/$(conf BACKUP_BUCKET_PREFIX) at ${e:-Amazon S3}}" ;;
  esac
}
dest_ready() {
  case $1 in
    folder) [[ -n $(conf BACKUP_FOLDER) ]] ;;
    server) [[ -n $(conf BACKUP_SERVER_HOST) && -n $(conf BACKUP_SERVER_USER) && -n $(conf BACKUP_SERVER_PATH) ]] ;;
    bucket) [[ -n $(conf BACKUP_BUCKET_NAME) && -n $(conf BACKUP_BUCKET_ACCESS_KEY_ID) && -n $(conf BACKUP_BUCKET_SECRET_ACCESS_KEY) ]] ;;
  esac
}
remote_target() {
  case $1 in
    server) printf 'dest:%s' "$(conf BACKUP_SERVER_PATH)" ;;
    bucket) local p; p=$(conf BACKUP_BUCKET_PREFIX); printf 'dest:%s%s' "$(conf BACKUP_BUCKET_NAME)" "${p:+/$p}" ;;
  esac
}
host_key_algos() { # the key types in a known_hosts file, so the server is asked for one that is listed there
  local t out=""
  for t in ssh-ed25519 ecdsa-sha2-nistp256 ecdsa-sha2-nistp384 ecdsa-sha2-nistp521 ssh-rsa; do
    awk -v t="$t" '$1 !~ /^@/ && $2 == t { f = 1 } END { exit !f }' "$1" 2>/dev/null || continue
    [[ $t == ssh-rsa ]] && t="rsa-sha2-512 rsa-sha2-256 ssh-rsa"
    out+="${out:+ }$t"
  done
  printf '%s' "${out:-ssh-ed25519 ecdsa-sha2-nistp256 rsa-sha2-512 rsa-sha2-256}"
}
rclone_run() { # rclone_run server|bucket DIR ro|rw rclone-arguments...: DIR is /data inside
  local kind=$1 mnt=$2 mode=$3
  shift 3
  (
    local a=(--rm -v "$mnt:/data:$mode" -e RCLONE_CONFIG=/tmp/rclone.conf -e XDG_CACHE_HOME=/tmp -e RCLONE_LOG_LEVEL=ERROR) net n v
    [[ $(id -u) != 0 ]] && a+=(--user "$(id -u):$(id -g)")
    net=$(conf BACKUP_DOCKER_NETWORK)
    [[ -n $net ]] && a+=(--network "$net")
    if [[ $kind == server ]]; then
      export RCLONE_CONFIG_DEST_TYPE=sftp RCLONE_CONFIG_DEST_HOST="$(conf BACKUP_SERVER_HOST)" RCLONE_CONFIG_DEST_USER="$(conf BACKUP_SERVER_USER)"
      v=$(conf BACKUP_SERVER_PORT); export RCLONE_CONFIG_DEST_PORT="${v:-22}"
      v=$(conf BACKUP_SERVER_KEY_FILE); if [[ -n $v ]]; then a+=(-v "$v:/run/cs/key:ro"); export RCLONE_CONFIG_DEST_KEY_FILE=/run/cs/key; fi
      v=$(conf BACKUP_SERVER_PASSWORD); [[ -n $v ]] && export RCLONE_CONFIG_DEST_PASS="$v"
      v=$(conf BACKUP_SERVER_KNOWN_HOSTS)
      if [[ -n $v ]]; then
        a+=(-v "$v:/run/cs/known_hosts:ro")
        export RCLONE_CONFIG_DEST_KNOWN_HOSTS_FILE=/run/cs/known_hosts RCLONE_CONFIG_DEST_HOST_KEY_ALGORITHMS="$(host_key_algos "$v")"
      fi
    else
      v=$(conf BACKUP_BUCKET_ENDPOINT)
      export RCLONE_CONFIG_DEST_TYPE=s3 RCLONE_CONFIG_DEST_PROVIDER="$([[ -n $v ]] && echo Other || echo AWS)" RCLONE_CONFIG_DEST_NO_CHECK_BUCKET=true
      [[ -n $v ]] && export RCLONE_CONFIG_DEST_ENDPOINT="$v"
      v=$(conf BACKUP_BUCKET_REGION); [[ -n $v ]] && export RCLONE_CONFIG_DEST_REGION="$v"
      export RCLONE_CONFIG_DEST_ACCESS_KEY_ID="$(conf BACKUP_BUCKET_ACCESS_KEY_ID)" RCLONE_CONFIG_DEST_SECRET_ACCESS_KEY="$(conf BACKUP_BUCKET_SECRET_ACCESS_KEY)"
    fi
    for n in ${!RCLONE_CONFIG_DEST_*}; do a+=(-e "$n"); done
    docker run "${a[@]}" "$RCLONE_IMAGE" "$@"
  )
}
setup_dest() { # asks for one destination's settings, tests it and saves them
  local v k test_dir
  case $1 in
    folder)
      ask v "Folder for the copies (an external drive, a network share)" "$(conf BACKUP_FOLDER)"
      [[ -n $v ]] || die "no folder given"
      mkdir -p "$v" || die "cannot create $v"
      save BACKUP_FOLDER "$(cd "$v" && pwd)"
      ;;
    server)
      ask v "Server name or address" "$(conf BACKUP_SERVER_HOST)"; save BACKUP_SERVER_HOST "$v"
      v=$(conf BACKUP_SERVER_PORT); ask v "SSH port" "${v:-22}"; save BACKUP_SERVER_PORT "$v"
      ask v "User on that server" "$(conf BACKUP_SERVER_USER)"; save BACKUP_SERVER_USER "$v"
      ask v "Folder on that server (it is created)" "$(conf BACKUP_SERVER_PATH)"; save BACKUP_SERVER_PATH "$v"
      k=$(conf BACKUP_SERVER_KEY_FILE)
      [[ -z $k && -f $HOME/.ssh/id_ed25519 ]] && k=$HOME/.ssh/id_ed25519
      [[ -z $k && -f $HOME/.ssh/id_rsa ]] && k=$HOME/.ssh/id_rsa
      ask v "SSH key file (none: use a password instead)" "${k:-none}"
      if [[ -n $v && $v != none ]]; then
        [[ -r $v ]] || die "cannot read $v"
        save BACKUP_SERVER_KEY_FILE "$v"; save BACKUP_SERVER_PASSWORD ""
      else
        ask_secret v "Password for that user"
        v=$(printf '%s' "$v" | docker run --rm -i "$RCLONE_IMAGE" obscure -)
        save BACKUP_SERVER_PASSWORD "$v"; save BACKUP_SERVER_KEY_FILE ""
      fi
      k=$(conf BACKUP_SERVER_KNOWN_HOSTS)
      [[ -z $k && -f $HOME/.ssh/known_hosts ]] && k=$HOME/.ssh/known_hosts
      ask v "known_hosts file to check the server's identity (none: not checked)" "${k:-none}"
      [[ $v == none ]] && v=""
      [[ -z $v ]] && warn "the server's identity will not be checked: connect once with ssh first, then give ~/.ssh/known_hosts"
      save BACKUP_SERVER_KNOWN_HOSTS "$v"
      ;;
    bucket)
      say "Endpoint examples: empty for Amazon S3; s3.eu-central-003.backblazeb2.com (Backblaze B2);"
      say "<account>.r2.cloudflarestorage.com (Cloudflare R2); s3.eu-central-1.wasabisys.com (Wasabi)."
      ask v "Endpoint (https://… or a host name; empty for Amazon S3)" "$(conf BACKUP_BUCKET_ENDPOINT)"; save BACKUP_BUCKET_ENDPOINT "$v"
      ask v "Region (e.g. eu-central-1; may be empty for other providers)" "$(conf BACKUP_BUCKET_REGION)"; save BACKUP_BUCKET_REGION "$v"
      ask v "Bucket name" "$(conf BACKUP_BUCKET_NAME)"; save BACKUP_BUCKET_NAME "$v"
      v=$(conf BACKUP_BUCKET_PREFIX); ask v "Folder inside the bucket" "${v:-curriculum-scope}"; save BACKUP_BUCKET_PREFIX "$v"
      ask v "Access key ID" "$(conf BACKUP_BUCKET_ACCESS_KEY_ID)"; save BACKUP_BUCKET_ACCESS_KEY_ID "$v"
      ask_secret v "Secret access key (Enter keeps the saved one)"
      [[ -n $v ]] && save BACKUP_BUCKET_SECRET_ACCESS_KEY "$v"
      ;;
  esac
  if [[ $1 != folder ]]; then
    say "Checking the connection..."
    test_dir=$(mktemp -d)
    CLEANUP+=("$test_dir")
    if rclone_run "$1" "$test_dir" ro mkdir "$(remote_target "$1")" >/dev/null && rclone_run "$1" "$test_dir" ro lsf "$(remote_target "$1")" --max-depth 1 >/dev/null; then
      say "Connected."
    else
      warn "could not reach $(dest_label "$1"); check the settings (saved in .env.backup)"
      return 1
    fi
  fi
}
setup_passfile() { # scheduled backups read the passphrase from a file that only you can read
  local f p q
  f=$(conf BACKUP_PASSPHRASE_FILE)
  ask f "File holding the passphrase, for scheduled backups (empty: always ask)" "${f:-$HOME/.curriculum-scope-backup-passphrase}"
  if [[ -z $f ]]; then save BACKUP_PASSPHRASE_FILE ""; return 0; fi
  if [[ ! -s $f ]]; then
    ask_secret p "Passphrase to keep in $f (12 characters or more)"
    ((${#p} >= 12)) || { warn "too short; nothing saved"; return 1; }
    ask_secret q "Type it again"
    [[ $p == "$q" ]] || { warn "they differ; nothing saved"; return 1; }
    mkdir -p "$(dirname "$f")"
    printf '%s\n' "$p" >"$f"
  fi
  chmod 600 "$f"
  save BACKUP_PASSPHRASE_FILE "$f"
  say "Saved. Keep a copy of the passphrase away from this server too: the backups cannot be opened without it."
}
cmd_destinations() {
  local c f
  while :; do
    f=$(conf BACKUP_PASSPHRASE_FILE)
    choose c "Set up which backup copy? (saved in .env.backup, readable by you only)" 5 "$(dest_label folder)" "$(dest_label server)" "$(dest_label bucket)" \
      "Passphrase file for scheduled backups${f:+: $f}" "Done"
    case $c in 1) setup_dest folder || true ;; 2) setup_dest server || true ;; 3) setup_dest bucket || true ;; 4) setup_passfile || true ;; *) break ;; esac
  done
}
pick_copies() { # sets COPIES (folder server bucket subset)
  local saved list a d i kinds=(folder server bucket)
  saved=$(conf BACKUP_COPY_TO)
  if [[ -n $TO ]]; then list=$TO
  elif ((YES)); then list=$saved
  else
    say "Copy this backup to (it is always kept in the backup folder too):" >/dev/tty
    for i in 1 2 3; do d=${kinds[i - 1]}; printf '  %d) %s%s\n' "$i" "$(dest_label "$d")" "$(dest_ready "$d" || echo ' (not set up yet)')" >/dev/tty; done
    ask a "Numbers separated by commas, or 0 for none" "$(printf '%s' "$saved" | sed 's/folder/1/;s/server/2/;s/bucket/3/' )"
    list=$(printf '%s' "$a" | sed 's/1/folder/;s/2/server/;s/3/bucket/;s/0//')
    if [[ $list != "$saved" ]] && confirm "Use this choice by default next time?" y; then save BACKUP_COPY_TO "$list"; fi
  fi
  COPIES=()
  for d in ${list//,/ }; do
    case $d in folder | server | bucket) ;; none | "") continue ;; *) die "unknown copy target $d (folder, server, bucket)" ;; esac
    if ! dest_ready "$d"; then
      ((YES)) && die "$d copies are not set up: run ops/cs.sh destinations"
      setup_dest "$d" || die "could not set up $d"
    fi
    COPIES+=("$d")
  done
  return 0
}
copy_out() { # copy_out KIND DIR FILE: copies FILE and FILE.sha256 to the destination
  local kind=$1 dir=$2 f=$3 target
  case $kind in
    folder)
      target=$(conf BACKUP_FOLDER)
      mkdir -p "$target" && cp -- "$dir/$f" "$dir/$f.sha256" "$target/" && (cd "$target" && sha256sum --quiet -c "$f.sha256")
      ;;
    server | bucket)
      target=$(remote_target "$kind")
      rclone_run "$kind" "$dir" ro copy /data "$target" --include "$f" --include "$f.sha256" --retries 3
      ;;
  esac
}
prune() { # prune KIND DIR DAYS: removes backups older than DAYS there
  local kind=$1 dir=$2 days=$3
  [[ $days =~ ^[0-9]+$ ]] && ((days > 0)) || return 0
  case $kind in
    local) find "$dir" -maxdepth 1 -name 'cs-backup-*' -mtime +"$days" -print -delete ;;
    folder) find "$(conf BACKUP_FOLDER)" -maxdepth 1 -name 'cs-backup-*' -mtime +"$days" -print -delete ;;
    server | bucket) rclone_run "$kind" "$dir" ro delete "$(remote_target "$kind")" --min-age "${days}d" --include 'cs-backup-*' ;;
  esac
}

# ------------------------------------------------------------------ backup
cmd_backup() {
  pick_env
  local dir ts name work enc=yes settings=no certs=no keep pass="" final d vol
  dir=$(backup_dir)
  lock "$dir"
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  name="cs-backup-$ENV_NAME-$ts"
  work="$dir/.work-$ts"
  mkdir -m 700 "$work"
  CLEANUP+=("$work" "$dir/$name.tar.partial" "$dir/$name.tar.enc.partial")

  # Choices: saved defaults, asked unless --yes.
  [[ $(conf BACKUP_INCLUDE_SETTINGS) == yes ]] && settings=yes
  confirm "Include the settings file ($ENV_FILE: passwords and keys)? Needed to rebuild a lost server" "${settings:0:1}" && settings=yes || settings=no
  [[ $(conf BACKUP_ENCRYPT) == no || $NO_ENCRYPT == 1 ]] && enc=no
  if [[ $settings == yes ]]; then enc=yes; say "The archive is encrypted, as it holds the settings file."
  else confirm "Encrypt the archive with a passphrase (recommended: it holds students' data)?" "${enc:0:1}" && enc=yes || enc=no; fi
  if [[ $ENV_NAME == prod ]]; then
    certs=yes; [[ $(conf BACKUP_INCLUDE_CERTIFICATES) == no ]] && certs=no
    confirm "Include the TLS certificates (Caddy)?" "${certs:0:1}" && certs=yes || certs=no
  fi
  pick_copies
  keep=$(conf BACKUP_KEEP_DAYS)
  if ((!YES)); then
    ask keep "Delete backups older than how many days, here and in the copies (0 = keep all)" "${keep:-30}"
    save BACKUP_INCLUDE_SETTINGS "$settings"; save BACKUP_ENCRYPT "$enc"; save BACKUP_KEEP_DAYS "$keep"
    [[ $ENV_NAME == prod ]] && save BACKUP_INCLUDE_CERTIFICATES "$certs"
  fi
  [[ $enc == yes ]] && { get_passphrase pass new; ensure_image; }

  step "Database"
  local db bk
  db=$(db_name); bk=$(envget DB_BACKUP_USER); bk=${bk:-curriculum_backup}
  if ((MANAGED)); then
    [[ -n $(envget BACKUP_DATABASE_URL) ]] || die "set BACKUP_DATABASE_URL in $ENV_FILE (the read-only backup role of the managed database)"
    BACKUP_URL=$(envget BACKUP_DATABASE_URL) pg_tool -e BACKUP_URL -- sh -c 'pg_dump --format=custom --compress=6 "$BACKUP_URL"' >"$work/database.dump"
    BACKUP_URL=$(envget BACKUP_DATABASE_URL) pg_tool -i -e BACKUP_URL -- sh -c 'psql "$BACKUP_URL" -v ON_ERROR_STOP=1 -At -F"|" -f -' <ops/verify.sql >"$work/verify-live.txt"
  else
    running postgres || die "the database is not running: start the installation first (ops/start.sh)"
    dc exec -T -e CS_DB="$db" -e CS_USER="$bk" postgres sh -c 'pg_dump -U "$CS_USER" -d "$CS_DB" --format=custom --compress=6' >"$work/database.dump"
    dc exec -T -e CS_DB="$db" -e CS_USER="$bk" postgres sh -c 'psql -U "$CS_USER" -d "$CS_DB" -v ON_ERROR_STOP=1 -At -F"|" -f -' <ops/verify.sql >"$work/verify-live.txt"
  fi
  [[ $(head -c 5 "$work/database.dump") == PGDMP ]] || die "the database dump is not valid"
  say "  $(du -h "$work/database.dump" | cut -f1), $(grep -c '^rows|' "$work/verify-live.txt") tables, migrations $(grep '^migrations|' "$work/verify-live.txt" | cut -d'|' -f2)"

  if [[ $settings == yes ]]; then
    step "Settings file"
    cp -- "$ENV_FILE" "$work/settings.env"; chmod 600 "$work/settings.env"
  fi
  if [[ $certs == yes ]]; then
    step "TLS certificates"
    vol="${PROJECT}_caddy_data"
    if docker volume inspect "$vol" >/dev/null 2>&1; then
      docker run --rm -v "$vol:/data:ro" "$TOOL_IMAGE" tar -czf - -C /data . >"$work/caddy-data.tar.gz"
    else
      warn "no certificate volume ($vol) yet: skipped"; certs=no
    fi
  fi

  {
    echo "format=cs-backup-1"
    echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "environment=$ENV_NAME"
    echo "project=$PROJECT"
    echo "database=$([[ $MANAGED == 1 ]] && echo managed || echo bundled)"
    echo "db_name=$db"
    echo "app_commit=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "app_image=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null | cut -c8-19 || echo unknown)"
    echo "includes=database$([[ $settings == yes ]] && echo ,settings)$([[ $certs == yes ]] && echo ,certificates)"
    (cd "$work" && for d in *; do [[ $d == manifest.txt ]] || echo "sha256.$d=$(sha256sum "$d" | cut -d' ' -f1)"; done)
  } >"$work/manifest.txt"

  step "Archive"
  tar -C "$work" -cf "$dir/$name.tar.partial" .
  if [[ $enc == yes ]]; then
    CS_BACKUP_PASSPHRASE=$pass docker run --rm -i -e CS_BACKUP_PASSPHRASE "$IMAGE" node dist/cli/backup-crypt.js encrypt <"$dir/$name.tar.partial" >"$dir/$name.tar.enc.partial"
    mv -f "$dir/$name.tar.enc.partial" "$dir/$name.tar.enc"
    rm -f "$dir/$name.tar.partial"
    final=$name.tar.enc
  else
    mv -f "$dir/$name.tar.partial" "$dir/$name.tar"
    final=$name.tar
  fi
  chmod 600 "$dir/$final"
  (cd "$dir" && sha256sum "$final" >"$final.sha256")
  rm -rf "$work"
  say "  $dir/$final ($(du -h "$dir/$final" | cut -f1)$([[ $enc == yes ]] && echo ', encrypted'))"

  for d in "${COPIES[@]}"; do
    step "Copy: $(dest_label "$d")"
    if copy_out "$d" "$dir" "$final"; then say "  copied"; else warn "the copy to $d failed"; FAILED+=("$d"); fi
  done

  if [[ $keep =~ ^[0-9]+$ ]] && ((keep > 0)); then
    step "Removing backups older than $keep days"
    prune local "$dir" "$keep"
    for d in "${COPIES[@]}"; do
      [[ " ${FAILED[*]-} " == *" $d "* ]] && continue # not where this backup did not arrive
      prune "$d" "$dir" "$keep" || warn "could not clean up old backups in $d"
    done
  fi

  step "Done"
  say "Backup: $dir/$final"
  [[ $enc == yes ]] && say "Keep the passphrase somewhere safe, apart from the backups: without it the backup cannot be opened."
  [[ $settings == no ]] && say "The settings file is not in this backup: keep a copy of $ENV_FILE (above all DATA_ENCRYPTION_KEY) in a password manager."
  if ((${#FAILED[@]})); then die "copies failed: ${FAILED[*]} (the backup itself is in $dir)"; fi
}

# ------------------------------------------------------------------ restore and test
list_backups() { # list_backups SOURCE BACKUP_DIR SCRATCH_DIR: archive names, newest first
  # shellcheck disable=SC2010 # newest first by time; the names are the scripts' own (cs-backup-<env>-<time>)
  case $1 in
    local) ls -1t "$2" 2>/dev/null | grep -E '^cs-backup-.*\.tar(\.enc)?$' || true ;;
    folder) ls -1t "$(conf BACKUP_FOLDER)" 2>/dev/null | grep -E '^cs-backup-.*\.tar(\.enc)?$' || true ;;
    server | bucket) rclone_run "$1" "$3" ro lsf "$(remote_target "$1")" --files-only --format tp --separator '|' --include 'cs-backup-*.tar' --include 'cs-backup-*.tar.enc' | sort -r | cut -d'|' -f2 ;;
  esac
}
fetch_backup() { # fetch_backup SOURCE DIR NAME STAGING: prints the local path of the archive
  case $1 in
    local) printf '%s' "$2/$3" ;;
    folder) cp -- "$(conf BACKUP_FOLDER)/$3" "$4/"; cp -- "$(conf BACKUP_FOLDER)/$3.sha256" "$4/" 2>/dev/null || true; printf '%s' "$4/$3" ;;
    server | bucket) rclone_run "$1" "$4" rw copy "$(remote_target "$1")" /data --include "$3" --include "$3.sha256" >&2; printf '%s' "$4/$3" ;;
  esac
}
pg_tool() { # pg_tool DOCKER-OPTIONS... -- COMMAND...: PostgreSQL client tools for a managed database
  local a=(--rm) v
  v=$(conf BACKUP_DOCKER_NETWORK); [[ -n $v ]] && a+=(--network "$v")
  while [[ $1 != -- ]]; do a+=("$1"); shift; done
  shift
  v=$(conf BACKUP_PG_IMAGE) # the client must be as new as the server: postgres:17-alpine for PostgreSQL 17
  docker run "${a[@]}" "${v:-$PG_IMAGE}" "$@"
}
psql_restored() { # psql_restored DB < sql: runs SQL on a database of the bundled server as the superuser
  dc exec -T -e CS_DB="$1" postgres sh -c 'psql -U "$POSTGRES_USER" -d "$CS_DB" -v ON_ERROR_STOP=1 -At -F"|" -f -'
}
admin_url_for() { printf '%s' "$1" | sed -E "s#(://[^/]*/)[^?]*#\1$2#"; }
restore_db() { # restore_db DUMP NEWDB: creates NEWDB and restores DUMP into it (bundled or managed)
  local dump=$1 new=$2 owner app bk
  owner=$(envget DB_OWNER_USER); owner=${owner:-curriculum_owner}
  app=$(envget DB_APP_USER); app=${app:-curriculum_app}
  bk=$(envget DB_BACKUP_USER); bk=${bk:-curriculum_backup}
  [[ $new =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "invalid database name $new"
  if ((MANAGED)); then
    [[ -n $RESTORE_URL ]] || die "no administrator connection for the managed database"
    ADMIN_URL=$RESTORE_URL TARGET_URL=$(admin_url_for "$RESTORE_URL" "$new") pg_tool -v "$(dirname "$dump"):/r:ro" -e ADMIN_URL -e TARGET_URL \
      -e NEW_DB="$new" -e OWNER="$owner" -e APPR="$app" -e BK="$bk" -e DUMP="/r/$(basename "$dump")" -- sh -ec '
        psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$NEW_DB\" OWNER \"$OWNER\""
        psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "REVOKE ALL ON DATABASE \"$NEW_DB\" FROM PUBLIC; GRANT CONNECT ON DATABASE \"$NEW_DB\" TO \"$APPR\", \"$BK\""
        pg_restore --exit-on-error --no-owner --role="$OWNER" -d "$TARGET_URL" "$DUMP" || { psql "$ADMIN_URL" -qc "DROP DATABASE \"$NEW_DB\""; exit 1; }'
  else
    running postgres || { say "Starting the database..."; dc up -d postgres >/dev/null; }
    wait_postgres
    local err
    err=$(dc cp "$dump" postgres:/tmp/cs-restore.dump 2>&1) || die "could not copy the backup into the database container: $err"
    dc exec -T -e NEW_DB="$new" -e OWNER="$owner" -e APPR="$app" -e BK="$bk" postgres sh -ec '
      trap "rm -f /tmp/cs-restore.dump" EXIT
      createdb -U "$POSTGRES_USER" -O "$OWNER" "$NEW_DB"
      psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -qc "REVOKE ALL ON DATABASE \"$NEW_DB\" FROM PUBLIC; GRANT CONNECT ON DATABASE \"$NEW_DB\" TO \"$APPR\", \"$BK\""
      pg_restore -U "$POSTGRES_USER" --exit-on-error -d "$NEW_DB" /tmp/cs-restore.dump || { dropdb -U "$POSTGRES_USER" "$NEW_DB"; exit 1; }'
  fi
}
verify_db() { # verify_db DB EXPECTED OUT: runs ops/verify.sql on DB and compares with the backup's
  local db=$1 expected=$2 out=$3 k a b
  if ((MANAGED)); then # as the backup role: the one role that reads every row despite row-level security
    TARGET_URL=$(admin_url_for "$(envget BACKUP_DATABASE_URL)" "$db") pg_tool -i -e TARGET_URL -- sh -c 'psql "$TARGET_URL" -v ON_ERROR_STOP=1 -At -F"|" -f -' <ops/verify.sql >"$out"
  else
    psql_restored "$db" <ops/verify.sql >"$out"
  fi
  for k in migrations forced_rls_tables; do
    a=$(grep "^$k|" "$expected" || true); b=$(grep "^$k|" "$out" || true)
    [[ $a == "$b" ]] || die "the restored database differs from the backup: $k is \"$b\", expected \"$a\""
  done
  say "  $(grep '^migrations|' "$out" | cut -d'|' -f2) migrations, row-level security forced on $(grep '^forced_rls_tables|' "$out" | cut -d'|' -f2) tables, $(grep -c '^rows|' "$out") tables"
  local diff
  diff=$(LC_ALL=C join -t'|' -j 2 <(grep '^rows|' "$expected" | LC_ALL=C sort -t'|' -k2,2) <(grep '^rows|' "$out" | LC_ALL=C sort -t'|' -k2,2) | awk -F'|' '$3 != $5 { printf "    %s: %s in the backup check, %s restored\n", $1, $3, $5 }')
  if [[ -n $diff ]]; then say "  Row counts that differ from the check made while the backup ran (it was taken while the app was running):"; say "$diff"
  else say "  Row counts: all $(grep -c '^rows|' "$out") tables match the backup."; fi
}
drop_db() {
  if ((MANAGED)); then ADMIN_URL=$RESTORE_URL pg_tool -e ADMIN_URL -e DB="$1" -- sh -c 'psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DB\""'
  else dc exec -T -e DB="$1" postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$DB"'; fi
}

base_db() { # the database name without a suffix added by an earlier restore or test
  local b=$1
  [[ $b =~ ^(.+)_(r|check_)[0-9]{14}$ ]] && b=${BASH_REMATCH[1]}
  printf '%s' "$b"
}
cmd_restore() {
  pick_env missing-ok
  local dir src name ts staging archive x c pass="" newdb olddb list n put_back=0
  dir=$(backup_dir)
  lock "$dir"
  ts=$(date -u +%Y%m%d%H%M%S)
  staging="$dir/.restore-$ts"
  mkdir -m 700 "$staging"
  CLEANUP+=("$staging")
  RESTORE_URL=""

  if [[ -n $FROM ]]; then src=$FROM
  else
    choose c "Restore from where?" 1 "This computer's backup folder ($dir)" "$(dest_label folder)" "$(dest_label server)" "$(dest_label bucket)"
    src=$(echo local folder server bucket | cut -d' ' -f"$c")
  fi
  case $src in local) ;; folder | server | bucket) dest_ready "$src" || setup_dest "$src" || die "could not set up $src" ;; *) die "--from must be local, folder, server or bucket" ;; esac

  mapfile -t list < <(list_backups "$src" "$dir" "$staging")
  ((${#list[@]})) || die "no backups found there"
  if [[ -n $PICK ]]; then
    name=$PICK
    printf '%s\n' "${list[@]}" | grep -qx "$name" || die "$name is not there"
  else
    n=${#list[@]}; ((n > 15)) && n=15
    choose c "Which backup? (newest first)" 1 "${list[@]:0:n}"
    name=${list[c - 1]}
  fi

  step "Fetching $name"
  archive=$(fetch_backup "$src" "$dir" "$name" "$staging")
  if [[ -f $archive.sha256 ]]; then (cd "$(dirname "$archive")" && sha256sum --quiet -c "$name.sha256") || die "the checksum of $name does not match: the file is damaged"; say "  checksum matches"
  else warn "no checksum file next to $name: not checked"; fi
  if [[ $name == *.enc ]]; then
    ensure_image
    get_passphrase pass existing
    CS_BACKUP_PASSPHRASE=$pass docker run --rm -i -e CS_BACKUP_PASSPHRASE "$IMAGE" node dist/cli/backup-crypt.js decrypt <"$archive" >"$staging/backup.tar" || die "could not decrypt $name (wrong passphrase, or a damaged file)"
    archive=$staging/backup.tar
    say "  decrypted"
  fi
  x="$staging/x"
  mkdir -m 700 "$x"
  tar -C "$x" -xf "$archive"
  [[ $(kv_get "$x/manifest.txt" format) == cs-backup-1 && -f $x/database.dump ]] || die "$name is not a Curriculum Scope backup"
  (cd "$x" && for f in database.dump settings.env caddy-data.tar.gz verify-live.txt; do
    [[ -f $f ]] || continue
    [[ $(sha256sum "$f" | cut -d' ' -f1) == $(kv_get manifest.txt "sha256.$f") ]] || die "$f inside the backup does not match its checksum"
  done)
  say "  Made $(kv_get "$x/manifest.txt" created) on the $(kv_get "$x/manifest.txt" environment) installation, app version $(kv_get "$x/manifest.txt" app_commit); contains $(kv_get "$x/manifest.txt" includes)"

  if ((NOENV)); then
    [[ -f $x/settings.env ]] || die "$ENV_FILE not found and this backup has no settings file: create $ENV_FILE first (the same DATA_ENCRYPTION_KEY as before; docs/DEPLOYMENT_GUIDE.md §8)"
    [[ $CMD == verify || $ONLY_VERIFY == 1 ]] && die "$ENV_FILE not found: restore the backup (not only test it) to put its settings file back"
    say "  $ENV_FILE is missing here: the settings file from the backup is put back."
    cp -- "$x/settings.env" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    put_back=1
    pick_env
  fi

  if ((MANAGED)); then
    [[ -n $(envget BACKUP_DATABASE_URL) ]] || die "set BACKUP_DATABASE_URL in $ENV_FILE (the backup role checks the restored database)"
    RESTORE_URL=$(envget RESTORE_ADMIN_URL)
    [[ -n $RESTORE_URL ]] || ask_secret RESTORE_URL "Administrator connection to the managed database server (postgres://admin:…@host:5432/postgres)"
  fi

  if [[ $CMD == verify || $ONLY_VERIFY == 1 ]]; then
    step "Testing the backup in a scratch database (nothing else changes)"
    newdb="$(base_db "$(db_name)")_check_$ts"
    [[ $newdb == _check_* ]] && newdb="cs_check_$ts"
    restore_db "$x/database.dump" "$newdb"
    if ! (verify_db "$newdb" "$x/verify-live.txt" "$staging/verify-restored.txt"); then drop_db "$newdb"; exit 1; fi
    drop_db "$newdb"
    say "The backup can be restored. (The scratch database $newdb was removed.)"
    return 0
  fi

  # 1. Settings: before the database, so passwords and keys match the data.
  if ((!put_back)) && [[ -f $x/settings.env ]] && confirm "Restore the settings file over $ENV_FILE? (the current one is kept as $ENV_FILE.before-restore-$ts)" "$([[ -f $ENV_FILE ]] && echo n || echo y)"; then
    [[ -f $ENV_FILE ]] && cp -p -- "$ENV_FILE" "$ENV_FILE.before-restore-$ts"
    cp -- "$x/settings.env" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    pick_env
    say "  settings restored"
  fi

  # 2. Database: into a new database; the current one is kept.
  olddb=$(db_name)
  newdb="$(base_db "$olddb")_r$ts"
  step "Restoring the database into a new database, $newdb ($olddb is not touched)"
  confirm "Go ahead?" y || die "stopped; nothing changed"
  restore_db "$x/database.dump" "$newdb"
  if ! (verify_db "$newdb" "$x/verify-live.txt" "$staging/verify-restored.txt"); then drop_db "$newdb"; die "nothing changed: the restored copy was removed"; fi

  # 3. Certificates.
  if [[ -f $x/caddy-data.tar.gz && $ENV_NAME == prod ]]; then
    local vol="${PROJECT}_caddy_data" fresh=y
    docker volume inspect "$vol" >/dev/null 2>&1 && fresh=n
    if confirm "Restore the TLS certificates too?" "$fresh"; then
      dc stop caddy >/dev/null 2>&1 || true
      if [[ $fresh == y ]]; then # made by Compose, so it recognises the volume later
        dc up --no-start --no-deps caddy >/dev/null 2>&1 || true
        docker volume inspect "$vol" >/dev/null 2>&1 || docker volume create "$vol" >/dev/null
      fi
      [[ $fresh == n ]] && docker run --rm -v "$vol:/data:ro" "$TOOL_IMAGE" tar -czf - -C /data . >"$dir/caddy-data-before-restore-$ts.tar.gz"
      docker run --rm -i -v "$vol:/data" "$TOOL_IMAGE" sh -c 'find /data -mindepth 1 -delete && tar -xzf - -C /data' <"$x/caddy-data.tar.gz"
      say "  certificates restored"
    fi
  fi

  # 4. Switch the app to the restored database.
  if ((MANAGED)); then
    step "Switching the app to $newdb"
    say "With a managed database, the database name changes in DATABASE_URL, MIGRATION_DATABASE_URL and BACKUP_DATABASE_URL."
  fi
  if confirm "Switch the app to $newdb now? It stops for about a minute; $olddb is kept" y; then
    local s
    for s in $(apps) worker; do dc stop "$s" >/dev/null 2>&1 || true; done
    cp -p -- "$ENV_FILE" "$ENV_FILE.before-switch-$ts"
    if ((MANAGED)); then
      for s in DATABASE_URL MIGRATION_DATABASE_URL BACKUP_DATABASE_URL; do [[ -n $(envget $s) ]] && kv_set "$ENV_FILE" "$s" "$(admin_url_for "$(envget $s)" "$newdb")"; done
    fi
    kv_set "$ENV_FILE" DB_NAME "$newdb"
    step "Starting with $newdb"
    mapfile -t c < <(scale_args)
    dc up -d "${c[@]}"
    for s in $(apps); do wait_ready "$s" || true; done
    if dc exec -T app node dist/cli/rotate-data-key.js --check >"$staging/keys.txt" 2>&1; then
      say "  The encryption key in $ENV_FILE reads every stored secret (two-factor and webhook secrets)."
    else
      warn "the encryption key in $ENV_FILE cannot read some stored secrets: restore the settings file from the same backup, or add the old key to DATA_ENCRYPTION_KEYS_PREVIOUS"
      cat "$staging/keys.txt" >&2
    fi
    step "Done"
    say "The app now uses $newdb. The previous database, $olddb, is kept; the previous settings are in $ENV_FILE.before-switch-$ts."
    if ((!MANAGED)); then
      [[ $(echo "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';" | psql_restored "$olddb" 2>/dev/null) == 0 ]] &&
        say "$olddb is empty (it was made when the database first started on this server)."
      say "When you no longer need $olddb: docker compose ${FILES[*]} --env-file $ENV_FILE exec postgres dropdb -U postgres $olddb"
    fi
  else
    say "Not switched. To switch later: set DB_NAME=$newdb in $ENV_FILE$([[ $MANAGED == 1 ]] && echo ' and the database name in the three URLs'), then run ops/start.sh."
  fi
}

# ------------------------------------------------------------------ menu
cmd_menu() {
  local c
  choose c "Curriculum Scope: what do you want to do?" 3 "Start" "Stop" "Status" "Back up" "Restore" "Test a backup (changes nothing)" "Set up backup copies (folder or USB drive, server, bucket)" "Quit"
  case $c in
    1) CMD=start; cmd_start ;; 2) CMD=stop; cmd_stop ;; 3) CMD=status; cmd_status ;; 4) CMD=backup; cmd_backup ;;
    5) CMD=restore; cmd_restore ;; 6) CMD=verify; cmd_restore ;; 7) CMD=destinations; cmd_destinations ;; *) ;;
  esac
}

command -v docker >/dev/null || die "Docker is not installed (https://docs.docker.com/engine/install/)"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (the docker-compose-plugin package)"
docker info >/dev/null 2>&1 || die "cannot reach Docker: is it running, and are you in the docker group (or root)?"

case ${CMD:-menu} in
  start) cmd_start ;; stop) cmd_stop ;; status) cmd_status ;; backup) cmd_backup ;;
  restore | verify) cmd_restore ;; destinations) cmd_destinations ;; menu) cmd_menu ;;
esac
