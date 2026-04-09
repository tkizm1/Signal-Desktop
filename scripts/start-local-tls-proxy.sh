#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TLS_DIR="$ROOT_DIR/.local-dev/tls"
CERT_FILE="$TLS_DIR/localhost-cert.pem"
KEY_FILE="$TLS_DIR/localhost-key.pem"
CHAT_LOG="$TLS_DIR/chat-proxy.log"
CDSI_LOG="$TLS_DIR/cdsi-proxy.log"
CHAT_PID_FILE="$TLS_DIR/chat-proxy.pid"
CDSI_PID_FILE="$TLS_DIR/cdsi-proxy.pid"

REMOTE_CHAT_HOST="${REMOTE_CHAT_HOST:-5.175.220.72}"
REMOTE_CHAT_PORT="${REMOTE_CHAT_PORT:-8080}"
REMOTE_CDSI_HOST="${REMOTE_CDSI_HOST:-5.175.220.72}"
REMOTE_CDSI_PORT="${REMOTE_CDSI_PORT:-8083}"

mkdir -p "$TLS_DIR"

cleanup_pid_file() {
  local pid_file="$1"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

if [[ ! -f "$CERT_FILE" || ! -f "$KEY_FILE" ]]; then
  echo "Generating local TLS certificate in $TLS_DIR"
  openssl req \
    -x509 \
    -newkey rsa:2048 \
    -sha256 \
    -days 3650 \
    -nodes \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
fi

cleanup_pid_file "$CHAT_PID_FILE"
cleanup_pid_file "$CDSI_PID_FILE"

nohup socat \
  OPENSSL-LISTEN:8080,bind=127.0.0.1,reuseaddr,fork,cert="$CERT_FILE",key="$KEY_FILE",verify=0 \
  TCP:"$REMOTE_CHAT_HOST":"$REMOTE_CHAT_PORT" \
  >"$CHAT_LOG" 2>&1 &
echo $! >"$CHAT_PID_FILE"

nohup socat \
  OPENSSL-LISTEN:8083,bind=127.0.0.1,reuseaddr,fork,cert="$CERT_FILE",key="$KEY_FILE",verify=0 \
  TCP:"$REMOTE_CDSI_HOST":"$REMOTE_CDSI_PORT" \
  >"$CDSI_LOG" 2>&1 &
echo $! >"$CDSI_PID_FILE"

echo "Local TLS proxies started."
echo "chat: https://localhost:8080 -> $REMOTE_CHAT_HOST:$REMOTE_CHAT_PORT"
echo "cdsi: https://localhost:8083 -> $REMOTE_CDSI_HOST:$REMOTE_CDSI_PORT"
echo "certificate: $CERT_FILE"
echo "logs: $CHAT_LOG , $CDSI_LOG"
