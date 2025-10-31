# Requires: Python 3.x, Node 18+, PowerShell
$ErrorActionPreference = "Stop"
$PORT = if ($env:PORT) { $env:PORT } else { 5173 }
$TIME_LIMIT = if ($env:TIME_LIMIT) { $env:TIME_LIMIT } else { 60 }
$API_PORT = if ($env:API_PORT) { $env:API_PORT } else { 8000 }

Write-Host "🔧 Checking Python venv..."
if (-not (Test-Path ".\.venv")) { py -m venv .venv }
. .\.venv\Scripts\Activate.ps1

Write-Host "📦 Installing solver deps..."
pip install -q --upgrade pip | Out-Null
pip install -q -r solver\requirements.txt | Out-Null

Write-Host "🧠 Running solver (time_limit=$TIME_LIMIT)..."
py solver\solver.py --in solver\sample_input_real.json --out solver\output.json --time_limit $TIME_LIMIT
Write-Host "✅ Solver finished → solver/output.json"

$env:SOLVER_TIME_LIMIT = "$TIME_LIMIT"
$env:API_PORT = "$API_PORT"

Write-Host "🚀 Starting solver API on port $API_PORT..."
$backendProcess = Start-Process -FilePath "py" -ArgumentList @('-m', 'uvicorn', 'backend.main:app', '--host', '0.0.0.0', '--port', $API_PORT) -PassThru -WindowStyle Hidden -WorkingDirectory (Get-Location)

try {
  Write-Host "📦 Preparing frontend deps..."
  Set-Location frontend
  try {
    if (Test-Path package-lock.json) { npm ci | Out-Null }
    else { npm install | Out-Null }
  } catch {
    npm install | Out-Null
  }

  if (-not (Test-Path ".\public")) { New-Item -ItemType Directory public | Out-Null }
  Copy-Item ..\solver\output.json .\public\output.json -Force
  Write-Host "✅ Copied to frontend/public/output.json"

  Write-Host "🌐 Starting dev server on port $PORT..."
  npm run dev -- --host 0.0.0.0 --strictPort --port $PORT
}
finally {
  if ($backendProcess -and !$backendProcess.HasExited) {
    Write-Host "`n🛑 Stopping solver API..."
    Stop-Process -Id $backendProcess.Id -Force
  }
}
