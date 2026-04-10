# Starts the booking API in a new window, then opens the demo form in your browser.
# Double-click Start-API.bat if PowerShell scripts are awkward to run.

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $RepoRoot "backend"

if (-not (Test-Path $Backend)) {
    Write-Host "Cannot find backend folder at: $Backend"
    exit 1
}

Set-Location $Backend

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host ""
    Write-Host "Created backend\.env from .env.example" -ForegroundColor Yellow
    Write-Host "Edit backend\.env and set GEMINI_API_KEY= (Google AI Studio)." -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "Installing Python dependencies (if needed)..." -ForegroundColor Cyan
python -m pip install -q -r requirements.txt

$keyLine = Get-Content ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*GEMINI_API_KEY=' }
if (-not $keyLine -or $keyLine -match '=\s*$') {
    Write-Host ""
    Write-Host "WARNING: GEMINI_API_KEY looks empty in backend\.env — Process will fail until you set it." -ForegroundColor Yellow
    Write-Host ""
}

$uvicornCmd = "Set-Location -LiteralPath '$Backend'; Write-Host 'Booking API — leave this window open. Ctrl+C to stop.' -ForegroundColor Green; python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
Start-Process powershell -ArgumentList @("-NoExit", "-NoProfile", "-Command", $uvicornCmd)

Write-Host "Waiting for server to listen on port 8000..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
}

if ($ready) {
    Start-Process "http://127.0.0.1:8000/demo/"
    Write-Host "Opened demo in your browser: http://127.0.0.1:8000/demo/" -ForegroundColor Green
} else {
    Write-Host "Server did not respond in time. Open http://127.0.0.1:8000/demo/ manually after it starts." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next: Chrome extension -> Options -> API base URL http://127.0.0.1:8000 and bearer token (if EXTRACT_BEARER_TOKENS is set in .env)." -ForegroundColor Cyan
Write-Host "API keeps running in the other PowerShell window. Close that window or press Ctrl+C there to stop the server." -ForegroundColor DarkGray

