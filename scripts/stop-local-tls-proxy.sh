#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TLS_DIR="$ROOT_DIR/.local-dev/tls"
CHAT_PID_FILE="$TLS_DIR/chat-proxy.pid"
CDSI_PID_FILE="$TLS_DIR/cdsi-proxy.pid"

stop_pid_file() {
  local pid_file="$1"

  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

stop_pid_file "$CHAT_PID_FILE"
stop_pid_file "$CDSI_PID_FILE"

echo "Local TLS proxies stopped."
