# Requires: Python 3.x, Node 18+, PowerShell
$ErrorActionPreference = "Stop"

Write-Host "🔧 Checking Python venv..."
if (-not (Test-Path ".\.venv")) {
  if (Get-Command py -ErrorAction SilentlyContinue) { py -m venv .venv }
  else { python -m venv .venv }
}
. .\.venv\Scripts\Activate.ps1

Write-Host "📦 Installing solver deps..."
pip install -r solver\requirements.txt

Write-Host "📦 Preparing frontend deps..."
Set-Location frontend
try {
  npm ci | Out-Null
  Write-Host "npm ci ok"
} catch {
  npm install | Out-Null
}

Write-Host "--------------------------------------"
Write-Host "Vite dev server starting on port 5173..."
Write-Host "--------------------------------------"
npm run dev -- --host 0.0.0.0 --strictPort --port 5173
