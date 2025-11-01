#!/usr/bin/env bash
set -euo pipefail

# 1) Python venv の有効化（既存の .venv を優先。無ければ作成）
if [ -d ".venv" ]; then
  source .venv/bin/activate
else
  python3 -m venv .venv
  source .venv/bin/activate
fi

# 2) solver 依存
pip install -r solver/requirements.txt

# 3) frontend 依存
cd frontend
# CI 環境など registry 制限がある場合は npm ci にフォールバック
if npm ci >/dev/null 2>&1; then
  echo "npm ci ok"
else
  npm install
fi

# 4) Vite dev を起動（0.0.0.0 固定、5173固定）
echo "--------------------------------------"
echo "Vite dev server starting on port 5173…"
echo "--------------------------------------"
npm run dev -- --host 0.0.0.0 --strictPort --port 5173
