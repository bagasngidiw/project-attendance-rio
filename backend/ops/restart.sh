#!/usr/bin/env bash

# cPanel cron watchdog for the manually supervised production API.
#
# The deploy client uploads tmp/restart.request after all application files are
# synchronized. This script runs as the cPanel account user, restarts only
# node processes whose working directory is this application, waits for the
# local health endpoint, and then acknowledges the deployment in
# tmp/restart.done.

set -u

APP_ROOT="${APP_ROOT:-/home/simbika1/backend_app}"
NODE_BIN="${NODE_BIN:-/home/simbika1/nodevenv/backend_app/20/bin/node}"
NPM_BIN="${NPM_BIN:-/home/simbika1/nodevenv/backend_app/20/bin/npm}"
PORT="${PORT:-5000}"

TMP_DIR="$APP_ROOT/tmp"
OPS_DIR="$APP_ROOT/ops"
LOCK_DIR="$TMP_DIR/restart.lock"
REQUEST_FILE="$TMP_DIR/restart.request"
DONE_FILE="$TMP_DIR/restart.done"
PID_FILE="$APP_ROOT/app.pid"
APP_LOG="$APP_ROOT/app.log"
RESTART_LOG="$OPS_DIR/restart.log"
PACKAGE_HASH_FILE="$TMP_DIR/package-lock.sha256"

if [ ! -d "$APP_ROOT" ]; then
  exit 1
fi

mkdir -p "$TMP_DIR" "$OPS_DIR"
exec >>"$RESTART_LOG" 2>&1

log() {
  printf '[restart] %s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

# mkdir is atomic. If a previous run was killed, remove only a stale lock.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  existing_lock_pid=""
  if [ -f "$LOCK_DIR/pid" ]; then
    existing_lock_pid="$(tr -d '[:space:]' < "$LOCK_DIR/pid" 2>/dev/null || true)"
  fi
  if [ -n "$existing_lock_pid" ] && kill -0 "$existing_lock_pid" 2>/dev/null; then
    exit 0
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null || exit 0
fi

trap 'rm -rf "$LOCK_DIR"' EXIT

cd "$APP_ROOT" || exit 1

find_app_pids() {
  for proc_dir in /proc/[0-9]*; do
    [ -d "$proc_dir" ] || continue

    pid="${proc_dir##*/}"
    [ "$pid" = "$$" ] && continue
    [ -r "$proc_dir/cmdline" ] || continue

    cwd="$(readlink "$proc_dir/cwd" 2>/dev/null || true)"
    [ "$cwd" = "$APP_ROOT" ] || continue

    cmdline="$(tr '\0' ' ' < "$proc_dir/cmdline" 2>/dev/null || true)"
    case "$cmdline" in
      *server.js*) printf '%s\n' "$pid" ;;
    esac
  done
}

port_is_listening() {
  if ! command -v ss >/dev/null 2>&1; then
    return 1
  fi

  ss -ltnH 2>/dev/null | awk -v suffix=":$PORT" '
    {
      address = $4;
      if (length(address) >= length(suffix) &&
          substr(address, length(address) - length(suffix) + 1) == suffix) {
        found = 1;
      }
    }
    END { exit found ? 0 : 1 }
  '
}

wait_for_processes_to_exit() {
  attempt=1
  while [ "$attempt" -le 15 ]; do
    remaining="$(find_app_pids)"
    [ -z "$remaining" ] && return 0
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

wait_for_port_to_free() {
  attempt=1
  while [ "$attempt" -le 15 ]; do
    if ! port_is_listening; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

stop_app() {
  pids="$(find_app_pids)"
  [ -z "$pids" ] && return 0

  log "stopping application PIDs: $(printf '%s ' $pids)"
  while IFS= read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done <<EOF
$pids
EOF

  if ! wait_for_processes_to_exit; then
    remaining="$(find_app_pids)"
    log "graceful stop timed out; force-stopping matching PIDs: $(printf '%s ' $remaining)"
    while IFS= read -r pid; do
      [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true
    done <<EOF
$remaining
EOF
    wait_for_processes_to_exit || return 1
  fi

  wait_for_port_to_free || {
    log "port $PORT is still occupied after stopping this application"
    return 1
  }
}

ensure_dependencies() {
  [ -f "$APP_ROOT/package-lock.json" ] || return 0

  current_hash="$(sha256sum "$APP_ROOT/package-lock.json" | awk '{print $1}')"
  previous_hash=""
  if [ -f "$PACKAGE_HASH_FILE" ]; then
    previous_hash="$(tr -d '[:space:]' < "$PACKAGE_HASH_FILE" 2>/dev/null || true)"
  fi

  [ "$current_hash" = "$previous_hash" ] && return 0

  if [ ! -x "$NPM_BIN" ]; then
    log "dependency hash changed but npm was not found at $NPM_BIN"
    return 1
  fi

  log "installing production dependencies before restart"
  if ! "$NPM_BIN" install --omit=dev; then
    log "dependency installation failed; existing application was not stopped"
    return 1
  fi

  current_hash="$(sha256sum "$APP_ROOT/package-lock.json" | awk '{print $1}')"
  printf '%s\n' "$current_hash" > "$PACKAGE_HASH_FILE"
}

wait_for_health() {
  attempt=1
  while [ "$attempt" -le 30 ]; do
    if curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

start_app() {
  if [ ! -x "$NODE_BIN" ]; then
    log "node was not found at $NODE_BIN"
    return 1
  fi

  log "starting production application"
  NODE_ENV=production PORT="$PORT" nohup "$NODE_BIN" server.js >>"$APP_LOG" 2>&1 &
  new_pid=$!
  printf '%s\n' "$new_pid" > "$PID_FILE"

  if ! wait_for_health; then
    log "application did not become healthy within 30 seconds"
    kill "$new_pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    return 1
  fi

  log "application is healthy on port $PORT (PID $new_pid)"
  return 0
}

force_restart=0
if [ "${1:-}" = "--force" ]; then
  force_restart=1
fi

request_id=""
if [ -f "$REQUEST_FILE" ]; then
  request_id="$(tr -d '[:space:]' < "$REQUEST_FILE" 2>/dev/null || true)"
fi

done_id=""
if [ -f "$DONE_FILE" ]; then
  done_id="$(tr -d '[:space:]' < "$DONE_FILE" 2>/dev/null || true)"
fi

running_pids="$(find_app_pids)"
needs_restart=0
if [ "$force_restart" -eq 1 ] || [ -z "$running_pids" ]; then
  needs_restart=1
elif [ -n "$request_id" ] && [ "$request_id" != "$done_id" ]; then
  needs_restart=1
fi

if [ "$needs_restart" -eq 0 ]; then
  exit 0
fi

log "restart requested${request_id:+ for $request_id}"

# Install dependencies before stopping a healthy process. A failed install
# therefore leaves the currently running version available to users.
ensure_dependencies || exit 1
stop_app || exit 1
start_app || exit 1

if [ -n "$request_id" ]; then
  printf '%s\n' "$request_id" > "$DONE_FILE"
  log "deployment acknowledged: $request_id"
else
  log "watchdog restart completed"
fi
