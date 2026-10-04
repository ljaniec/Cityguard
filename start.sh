#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export TMPDIR="${TMPDIR:-$HOME/.cache/pip-tmp}"
mkdir -p "$TMPDIR"

need_setup=0
[[ -x backend/.venv/bin/uvicorn ]] || need_setup=1
[[ -x ml/.venv/bin/python ]] || need_setup=1
[[ -x frontend/node_modules/.bin/vite ]] || need_setup=1

if [[ "$need_setup" -eq 1 ]]; then
  echo "Pierwsze odpalenie — instaluję zależności…"
  if [[ ! -x backend/.venv/bin/uvicorn ]]; then
    python3 -m venv backend/.venv
    backend/.venv/bin/pip install -q -r backend/requirements.txt
  fi
  if [[ ! -x ml/.venv/bin/python ]]; then
    python3 -m venv ml/.venv
    ml/.venv/bin/pip install -q -r ml/requirements.txt
  fi
  if [[ ! -x frontend/node_modules/.bin/vite ]]; then
    (cd frontend && npm install)
  fi
fi

if ! curl -sf -o /dev/null --connect-timeout 1 "http://127.0.0.1:8000/api/events" 2>/dev/null; then
  backend/.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 &
  api_pid=$!
else
  api_pid=""
  echo "API już działa na :8000"
fi

cleanup() {
  if [[ -n "${api_pid}" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo
echo "CityGuard:  http://127.0.0.1:5173"
echo "Zatrzymanie: Ctrl+C"
echo

cd frontend
npm run dev
