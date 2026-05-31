# dev.ps1 — launch backend (FastAPI) and frontend (Vite) for local development.
# Usage:  .\dev.ps1
# Backend runs on http://localhost:8000, frontend on http://localhost:5173
# (the Vite dev server proxies /api -> :8000).

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Headless matplotlib for the capture engine.
$env:MPLBACKEND = "Agg"

$backendPy = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $backendPy)) {
    Write-Error "Backend venv not found. Create it with:`n  py -m venv backend\.venv`n  backend\.venv\Scripts\python -m pip install -r backend\requirements.txt"
}

Write-Host "Starting backend on :8000 ..." -ForegroundColor Cyan
$backend = Start-Process -PassThru -WorkingDirectory (Join-Path $root "backend") `
    -FilePath $backendPy `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"

try {
    Write-Host "Starting frontend on :5173 (Ctrl+C to stop both) ..." -ForegroundColor Cyan
    Push-Location (Join-Path $root "frontend")
    npm run dev
}
finally {
    Pop-Location
    if ($backend -and -not $backend.HasExited) {
        Write-Host "Stopping backend ..." -ForegroundColor Yellow
        Stop-Process -Id $backend.Id -Force
    }
}
