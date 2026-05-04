# deploy-fly.ps1 — one-shot Fly.io deploy for praetor-api.
#
# Usage (from packages/api/):
#   .\deploy-fly.ps1                   # deploy with secrets already set
#   .\deploy-fly.ps1 -InitSecrets      # also push secrets from ../../../mnemopay-sdk/.env
#   .\deploy-fly.ps1 -InitApp          # first-run; creates the app via fly launch
#
# Prereqs:
#   1. flyctl installed: iwr https://fly.io/install.ps1 -useb | iex
#   2. fly auth login   (interactive; can't be automated)
#   3. Run from packages/api/ so fly.toml is found
#
# What this script does:
#   - InitApp: runs `fly launch --no-deploy --copy-config` to register the app
#   - InitSecrets: reads ../../../mnemopay-sdk/.env, pushes the required keys
#   - Deploy: runs `fly deploy --remote-only --dockerfile ../../Dockerfile`
#
# Secrets the api needs (per DEPLOY.md):
#   Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
#   Recommended: ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY,
#                MNEMOPAY_API_KEY, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION

param(
    [switch]$InitApp,
    [switch]$InitSecrets,
    [string]$EnvFile = "..\..\..\mnemopay-sdk\.env"
)

$ErrorActionPreference = "Stop"

# ── Check flyctl is installed ─────────────────────────────────────────────
$fly = Get-Command fly -ErrorAction SilentlyContinue
if (-not $fly) {
    Write-Host "flyctl not found. Install:" -ForegroundColor Red
    Write-Host "  iwr https://fly.io/install.ps1 -useb | iex" -ForegroundColor Yellow
    exit 1
}

# ── Check fly auth ────────────────────────────────────────────────────────
$authOut = & fly auth whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Not authed with Fly. Run:" -ForegroundColor Red
    Write-Host "  fly auth login" -ForegroundColor Yellow
    exit 1
}
Write-Host "[deploy] authed as: $authOut" -ForegroundColor Green

# ── Verify we're in packages/api ──────────────────────────────────────────
if (-not (Test-Path ".\fly.toml")) {
    Write-Host "fly.toml not found. Run this script from packages/api/." -ForegroundColor Red
    exit 1
}

# ── First-run app creation ────────────────────────────────────────────────
if ($InitApp) {
    Write-Host "[deploy] running fly launch --no-deploy --copy-config" -ForegroundColor Cyan
    & fly launch --no-deploy --copy-config
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# ── Read .env and push as Fly secrets ─────────────────────────────────────
if ($InitSecrets) {
    $envPath = Resolve-Path $EnvFile -ErrorAction SilentlyContinue
    if (-not $envPath) {
        Write-Host "Env file not found at $EnvFile" -ForegroundColor Red
        exit 1
    }
    Write-Host "[deploy] reading secrets from $envPath" -ForegroundColor Cyan

    $wantKeys = @(
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
        "MNEMOPAY_API_KEY",
        "AZURE_SPEECH_KEY",
        "AZURE_SPEECH_REGION",
        "RESEND_API_KEY",
        "MAILEROO_API_KEY",
        "STRIPE_SECRET_KEY",
        "FAL_KEY"
    )

    $secretArgs = @()
    Get-Content $envPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $eqIdx = $line.IndexOf("=")
        if ($eqIdx -lt 1) { return }
        $k = $line.Substring(0, $eqIdx).Trim()
        $v = $line.Substring($eqIdx + 1).Trim().Trim('"').Trim("'")
        if ($wantKeys -contains $k -and $v.Length -gt 0) {
            $secretArgs += "$k=$v"
            Write-Host "  + $k ($($v.Length) chars)" -ForegroundColor DarkGray
        }
    }

    if ($secretArgs.Count -eq 0) {
        Write-Host "[deploy] no matching secrets in $envPath" -ForegroundColor Yellow
    } else {
        Write-Host "[deploy] pushing $($secretArgs.Count) secrets" -ForegroundColor Cyan
        & fly secrets set @secretArgs --stage
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
}

# ── Deploy ────────────────────────────────────────────────────────────────
Write-Host "[deploy] fly deploy --remote-only --dockerfile ../../Dockerfile" -ForegroundColor Cyan
& fly deploy --remote-only --dockerfile ../../Dockerfile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[deploy] done." -ForegroundColor Green
& fly status
& fly logs --no-tail | Select-Object -Last 20
