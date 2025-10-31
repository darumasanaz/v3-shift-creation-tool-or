#!/usr/bin/env bash
set -euo pipefail

# ---- Settings (overridable) ----
PORT="${PORT:-5173}"
TIME_LIMIT="${TIME_LIMIT:-60}"
API_PORT="${API_PORT:-8000}"
PY="${PY:-python3}"

# ---- Helpers ----
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

backend_pid=""
cleanup() {
  if [[ -n "${backend_pid}" ]]; then
    echo "\n🛑 Stopping solver API..."
    kill "${backend_pid}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "\U0001F527 Checking Python venv..."
if [[ ! -d .venv ]]; then
  ("${PY}" -m venv .venv) || (python -m venv .venv)
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo "\U0001F4E6 Installing solver deps (if needed)..."
pip install --quiet --upgrade pip >/dev/null
pip install --quiet -r solver/requirements.txt >/dev/null || true

export SOLVER_TIME_LIMIT="${TIME_LIMIT}"
export API_PORT

echo "\U0001F680 Starting solver API on port ${API_PORT}..."
"${PY}" -m uvicorn backend.main:app --host 0.0.0.0 --port "${API_PORT}" >/tmp/solver-api.log 2>&1 &
backend_pid=$!
sleep 1

echo "\U0001F9E0 Running solver (time_limit=${TIME_LIMIT})..."
"${PY}" solver/solver.py \
  --in solver/sample_input_real.json \
  --out solver/output.json \
  --time_limit "${TIME_LIMIT}"
echo "✅ Solver finished → solver/output.json"

echo "\U0001F4E6 Preparing frontend deps..."
pushd frontend >/dev/null
# prefer lockfile if exists
if command -v npm >/dev/null 2>&1; then
  if [[ -f package-lock.json ]]; then
    npm ci >/dev/null 2>&1 || npm install >/dev/null 2>&1
  else
    npm install >/dev/null 2>&1
  fi
else
  echo "❌ npm not found"; exit 1
fi

mkdir -p public
cp -f ../solver/output.json public/output.json
echo "✅ Copied to frontend/public/output.json"

echo "\U0001F310 Starting dev server on port ${PORT}..."
echo "   (If in Codespaces, open forwarded port ${PORT})"
npm run dev -- --host 0.0.0.0 --strictPort --port "${PORT}"
popd >/dev/null
