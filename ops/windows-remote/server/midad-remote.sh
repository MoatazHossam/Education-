#!/usr/bin/env bash
# Midad remote helper: the server side of the Windows remote-control files in ops/windows-remote
# (docs/DEPLOYMENT_GUIDE.md §8.12). "Midad - Setup first time.bat" installs it as /usr/local/sbin/midad-remote,
# owned by root, and the other files run it with sudo over SSH. It only calls the installation's own
# scripts (ops/midad.sh, scripts/rolling-restart.sh), Docker and the system's package manager.
#
#   sudo midad-remote [--dir /opt/midad] [--env prod|dev] [ACTION]
#
#   menu       the control panel: the actions below, one after another, with one sudo password (the default)
#   status     the services and whether the app answers
#   monitor    status, resources, disk, memory and the newest backup, refreshed every 10 s (Ctrl+C stops)
#   backup     back up now with the saved choices (as the nightly backup does)
#   verify     test the newest backup in a scratch database (changes nothing)
#   backups    the backups kept, their checksums, the last tests and errors, the schedule
#   report     the daily report, emailed to the saved address
#   logs       follow the app and worker logs (Ctrl+C stops)
#   restart    restart app, app2 and the worker one at a time: the website stays up
#   start      start Midad                 stop      stop Midad (asks first)
#   updates    install the server's system updates (asks first)
#   reboot     restart the server (asks first)
#   download-prepare   copy the backups into the SSH user's home, for the PC to fetch and remove
#   check      what the setup on the PC checks           version   this helper's version
set -euo pipefail
umask 077

HELPER_VERSION=1
DIR=/opt/midad ENV_NAME=prod ACTION=""
LOG=/var/log/midad-backup.log INTERVAL=10 TZ_SHOW=Africa/Cairo
CRON_FILE=/etc/cron.d/midad REBOOT_FLAG=/var/run/reboot-required
ENV_FILE="" FILES=()
MENU=(
  "status|Status"
  "monitor|Live monitor"
  "backup|Back up now"
  "verify|Test the newest backup"
  "backups|Backups kept, tests and schedule"
  "report|Daily report (emailed)"
  "logs|Logs"
  "restart|Restart the app (no downtime)"
  "start|Start Midad"
  "stop|Stop Midad"
  "updates|Server system updates"
  "reboot|Reboot the server"
)

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
sure() { # sure "Question": yes only for an answer starting with y
  local a
  read -r -p "$1 (y/n) " a || return 1
  [[ $a =~ ^[Yy] ]]
}
sure_word() { # sure_word WORD "Question": yes only when WORD is typed
  local a
  read -r -p "$2: " a || return 1
  [[ ${a,,} == "$1" ]]
}

conf() { # conf KEY: a setting from .env.backup, without quotes
  local f=$DIR/.env.backup line
  [[ -f $f ]] || return 0
  line=$(grep -E "^[[:space:]]*$1=" "$f" | tail -n 1 || true)
  line=${line#*=}
  line=${line%$'\r'}
  line=${line#[\"\']}
  line=${line%[\"\']}
  printf '%s' "$line"
}
setup_env() {
  case $ENV_NAME in
    prod) ENV_FILE=.env.production; FILES=(-f docker-compose.yml -f docker-compose.prod.yml) ;;
    dev) ENV_FILE=.env.docker; FILES=(-f docker-compose.yml) ;;
    *) die "--env must be prod or dev" ;;
  esac
  local tz
  tz=$(conf REPORT_TIME_ZONE)
  TZ_SHOW=${tz:-Africa/Cairo}
}
dc() { (cd "$DIR" && docker compose "${FILES[@]}" --env-file "$ENV_FILE" "$@"); }
midad() { bash "$DIR/ops/midad.sh" "$@"; }
backup_dir() {
  local d
  d=$(conf BACKUP_DIR)
  printf '%s' "${d:-$DIR/backups}"
}
when() { TZ=$TZ_SHOW date -d "@$1" '+%Y-%m-%d %H:%M'; }
age() { # age SECONDS: "3 h 20 min" and the like
  local s=$1
  if ((s < 3600)); then printf '%d min' $((s / 60))
  elif ((s < 172800)); then printf '%d h %d min' $((s / 3600)) $((s % 3600 / 60))
  else printf '%d days' $((s / 86400)); fi
}
human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || printf '%s bytes' "$1"; }
archives() { # this installation's backup archives, newest first (the name carries the time)
  local d f
  d=$(backup_dir)
  for f in "$d"/midad-backup-"$ENV_NAME"-*.tar*; do
    if [[ -f $f && $f != *.sha256 ]]; then printf '%s\n' "$f"; fi
  done | sort -r
}
checksum() { # checksum FILE: ok, damaged or no checksum
  [[ -f $1.sha256 ]] || { printf 'no checksum'; return 0; }
  if (cd "$(dirname "$1")" && sha256sum --quiet -c "$(basename "$1").sha256" >/dev/null 2>&1); then printf 'ok'; else printf 'DAMAGED'; fi
}
newest_backup() {
  local f now
  f=$(archives | sed -n 1p)
  [[ -n $f ]] || { say "No backup in $(backup_dir)"; return 0; }
  now=$(date +%s)
  say "$(basename "$f"): $(when "$(stat -c %Y "$f")") ($(age $((now - $(stat -c %Y "$f")))) ago), $(human "$(stat -c %s "$f")"), checksum $(checksum "$f")"
}
logged() { # logged COMMAND...: its output also goes to the backup log, where the daily report reads it
  local rc=0
  touch "$LOG" 2>/dev/null || true
  "$@" 2>&1 | tee -a "$LOG" || rc=$?
  return "$rc"
}
reboot_note() {
  if [[ -f $REBOOT_FLAG ]]; then
    say "The server asks for a restart to finish its updates: choose \"Reboot the server\" at a quiet time."
  else
    say "No server restart is needed."
  fi
}

# ------------------------------------------------------------------ actions
act_status() { midad status --env "$ENV_NAME"; }
act_start() { midad start --env "$ENV_NAME" --yes; }
act_stop() {
  sure "Stop Midad? The website stops for everyone until you start it again" || { say "Nothing was stopped."; return 0; }
  midad stop --env "$ENV_NAME" --yes
}
act_restart() {
  if [[ $ENV_NAME == prod && -f $DIR/scripts/rolling-restart.sh ]]; then
    (cd "$DIR" && ENV_FILE=$ENV_FILE bash scripts/rolling-restart.sh)
  else
    midad stop --env "$ENV_NAME" --yes
    midad start --env "$ENV_NAME" --yes
  fi
}
act_backup() { logged midad backup --env "$ENV_NAME" --yes; }
act_verify() { logged midad restore --env "$ENV_NAME" --yes --from local --only-verify; }
act_report() { midad report --env "$ENV_NAME"; }
act_logs() {
  trap 'exit 0' INT
  say "The app's logs as they come (Ctrl+C stops):"
  if [[ $ENV_NAME == prod ]]; then dc logs -f --tail 100 app app2 worker; else dc logs -f --tail 100 app worker; fi
}
act_backups() {
  local d f n=0 now last tests t
  d=$(backup_dir)
  now=$(date +%s)
  say "Backups in $d, newest first (times in $TZ_SHOW):"
  while IFS= read -r f; do
    [[ -n $f ]] || continue
    n=$((n + 1))
    if ((n <= 15)); then
      printf '  %s  %8s  %-11s  %s\n' "$(when "$(stat -c %Y "$f")")" "$(human "$(stat -c %s "$f")")" "$(checksum "$f")" "$(basename "$f")"
    fi
  done < <(archives)
  ((n)) || say "  none"
  ((n <= 15)) || say "  ... and $((n - 15)) older"
  if ((n)); then
    last=$(archives | sed -n 1p)
    say "Newest: $(age $((now - $(stat -c %Y "$last")))) ago."
  fi
  say ""
  say "Restore tests that worked (the last 3):"
  # Each test's scratch database is named after its time, in UTC.
  tests=$( { grep -oE 'can be restored\. \(The scratch database [^ ]*_check_[0-9]{14}' "$LOG" 2>/dev/null || true; } | tail -n 3 | grep -oE '[0-9]{14}$' || true)
  if [[ -n $tests ]]; then
    while IFS= read -r t; do
      say "  $(when "$(date -u -d "${t:0:4}-${t:4:2}-${t:6:2} ${t:8:2}:${t:10:2}:${t:12:2}" +%s)")"
    done <<<"$tests"
  else
    say "  none in $LOG"
  fi
  say ""
  say "Errors in the backup log (the last 3):"
  if [[ -f $LOG ]] && grep -q '^Error:' "$LOG"; then grep '^Error:' "$LOG" | tail -n 3 | sed 's/^/  /'; else say "  none"; fi
  say ""
  say "Schedule ($CRON_FILE, server time $(date +%Z)):"
  if [[ -f $CRON_FILE ]]; then grep -vE '^[[:space:]]*(#|$)' "$CRON_FILE" | sed 's/^/  /'; else say "  no schedule"; fi
}
monitor_once() {
  local ids
  say "Midad on $(hostname), $(TZ=$TZ_SHOW date '+%Y-%m-%d %H:%M:%S') ($TZ_SHOW)"
  midad status --env "$ENV_NAME" 2>&1 || true
  say ""
  say "== Resources"
  ids=$(dc ps -q 2>/dev/null || true)
  # shellcheck disable=SC2086 # one argument per container id
  [[ -z $ids ]] || docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' $ids 2>&1 || true
  say ""
  say "== Server"
  say "Up $(uptime -p 2>/dev/null | sed 's/^up //'), load $(cut -d' ' -f1-3 /proc/loadavg)"
  df -hP / | awk 'NR == 2 { print "Disk /: " $5 " used, " $4 " free" }'
  free -m | awk '/^Mem:/ { print "Memory: " $7 " MB free of " $2 " MB" }'
  reboot_note
  say ""
  say "== Newest backup"
  newest_backup
}
act_monitor() {
  local out
  trap 'say ""; say "Stopped watching."; exit 0' INT
  say "Collecting the first figures..."
  while :; do
    out=$(monitor_once 2>&1 || true)
    printf '\033[H\033[2J'
    printf '%s\n\nRefreshed every %s s. Ctrl+C stops watching.\n' "$out" "$INTERVAL"
    sleep "$INTERVAL"
  done
}
act_updates() {
  local list
  say "Looking for system updates..."
  apt-get update -qq
  list=$(apt list --upgradable 2>/dev/null | grep -v '^Listing' || true)
  if [[ -z $list ]]; then
    say "The server is up to date."
    reboot_note
    return 0
  fi
  say "$list"
  if grep -qE '^(docker|containerd)' <<<"$list"; then
    say "These include Docker: the website stops for about a minute while Docker restarts."
  else
    say "The website keeps running while they install."
  fi
  sure "Install them now?" || { say "Nothing was installed."; return 0; }
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
  say ""
  reboot_note
}
act_reboot() {
  reboot_note
  if systemctl is-enabled --quiet docker 2>/dev/null; then
    say "The website is offline for 1 to 3 minutes while the server restarts; Midad starts again by itself."
  else
    say "Docker does not start by itself on this server: after the restart, run Start."
  fi
  sure_word reboot "Type reboot to restart the server now (anything else cancels)" || { say "Not restarted."; return 0; }
  say "Restarting. This window loses its connection: wait 3 minutes, then run Status."
  systemctl reboot
}
act_download_prepare() {
  local user=${SUDO_USER:-} home dest f n=0
  [[ -n $user && $user != root ]] || die "run it with sudo from your own account"
  home=$(getent passwd "$user" | cut -d: -f6)
  [[ -n $home && -d $home ]] || die "no home folder for $user"
  dest=$home/.midad-download
  rm -rf -- "$dest"
  install -d -m 700 -o "$user" "$dest"
  while IFS= read -r f; do
    [[ -n $f ]] || continue
    cp -p -- "$f" "$dest/"
    [[ -f $f.sha256 ]] && cp -p -- "$f.sha256" "$dest/"
    n=$((n + 1))
  done < <(archives)
  chown -R "$user" "$dest"
  ((n)) || die "no backup in $(backup_dir) to download"
  say "$n backups ready to download ($(du -sh "$dest" | cut -f1))."
}
act_check() {
  local v
  say "midad-remote $HELPER_VERSION"
  v=$(head -n 1 "$DIR/VERSION" 2>/dev/null || true)
  [[ $v == *Format* ]] && v=""
  say "Midad in $DIR: ${v:-version not recorded}"
  [[ -f $DIR/$ENV_FILE ]] || die "$DIR/$ENV_FILE not found: is --env right?"
  docker info >/dev/null 2>&1 || die "Docker is not running"
  say "Docker: running"
  say "Backups: $(archives | wc -l) in $(backup_dir)"
}
act_version() { say "midad-remote $HELPER_VERSION"; }

run_action() { ( trap - INT; "act_${1//-/_}" ); }
act_menu() {
  local c i
  trap ':' INT # Ctrl+C ends the action that runs (monitor, logs), not the menu
  while :; do
    say ""
    say "Midad control panel: $(hostname), $DIR"
    for i in "${!MENU[@]}"; do printf '  %2d) %s\n' $((i + 1)) "${MENU[i]#*|}"; done
    say "   0) Leave"
    read -r -p "Choose: " c || return 0
    [[ $c == 0 || $c == [qQ] ]] && return 0
    if [[ $c =~ ^[0-9]+$ ]] && ((c >= 1 && c <= ${#MENU[@]})); then
      run_action "${MENU[c - 1]%%|*}" || say "(It stopped with an error: see above.)"
      read -r -p "Press Enter for the menu " _ || return 0
    else
      say "Type a number from the list."
    fi
  done
}

main() {
  while (($#)); do
    case $1 in
      --dir) DIR=${2:?--dir needs a folder}; shift ;;
      --env) ENV_NAME=${2:?--env needs prod or dev}; shift ;;
      -h | --help | help) usage; return 0 ;;
      -*) die "unknown option $1 (midad-remote --help)" ;;
      *) [[ -z $ACTION ]] || die "one action at a time ($ACTION, $1)"; ACTION=$1 ;;
    esac
    shift
  done
  ACTION=${ACTION:-menu}
  declare -F "act_${ACTION//-/_}" >/dev/null || die "unknown action $ACTION (midad-remote --help)"
  [[ $ACTION == version ]] && { act_version; return 0; }
  [[ $(id -u) == 0 ]] || die "run it with sudo: sudo midad-remote $ACTION"
  [[ $DIR == /* && -f $DIR/ops/midad.sh ]] || die "no Midad installation in $DIR (--dir)"
  setup_env
  cd "$DIR"
  "act_${ACTION//-/_}"
}

[[ ${BASH_SOURCE[0]} != "$0" ]] || main "$@"
