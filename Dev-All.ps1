# One-shot dev: start API (new window), wait for health, open Chrome with unpacked extension + demo.
# Run from repo root:  powershell -ExecutionPolicy Bypass -File .\Dev-All.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtensionDir = Join-Path $RepoRoot "extension"
$Backend = Join-Path $RepoRoot "backend"

if (-not (Test-Path (Join-Path $ExtensionDir "manifest.json"))) {
    Write-Host "Extension folder not found: $ExtensionDir" -ForegroundColor Red
    exit 1
}

Write-Host "Starting API (separate window)..." -ForegroundColor Cyan
& (Join-Path $RepoRoot "Start-API.ps1")

$chrome = $null
foreach ($p in @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )) {
    if (Test-Path $p) {
        $chrome = $p
        break
    }
}

if (-not $chrome) {
    Write-Host "Chrome.exe not found. Load unpacked manually: chrome://extensions -> $ExtensionDir" -ForegroundColor Yellow
    exit 0
}

$extArg = "--load-extension=$ExtensionDir"
Write-Host "Opening Chrome with extension loaded + demo..." -ForegroundColor Cyan
Start-Process -FilePath $chrome -ArgumentList @($extArg, "http://127.0.0.1:8000/demo/")
Write-Host "Done. Pin the extension if you like. API runs in the other PowerShell window." -ForegroundColor Green
