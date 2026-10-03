#!/bin/sh
set -eu
PORT="${PORT:-8000}"
export CITYGUARD_API="${CITYGUARD_API:-http://127.0.0.1:${PORT}}"
exec uvicorn asgi:app --host 0.0.0.0 --port "$PORT"
