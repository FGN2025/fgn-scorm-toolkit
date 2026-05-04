<#
.SYNOPSIS
  Deploy the scorm-build edge function to FGN2025/stratify-workforce
  by direct git push, then point you at Lovable for the redeploy.

.DESCRIPTION
  Lovable's agent can't fetch arbitrary URLs from GitHub, so deploying
  a multi-file edge function (scorm-build has an index.ts plus 22
  vendored files in _lib/) requires pushing the source to the
  stratify-workforce repo directly. Lovable then redeploys when asked.

  This script:
    1. Clones FGN2025/stratify-workforce to ~/fgn-deploys/stratify-workforce
       if it isn't already there. Pulls latest if it is.
    2. Copies the toolkit's supabase/functions/scorm-build/ directory
       into the clone, replacing any prior copy.
    3. Stages, commits, and pushes to main.
    4. Prints the message to send to Lovable to trigger redeploy.

  Idempotent -- safe to re-run after toolkit changes; only pushes if
  there are real diffs.

.NOTES
  Requires:
    - gh CLI authenticated (we set this up in earlier sessions)
    - git CLI

  The clone lives OUTSIDE Dropbox at $env:USERPROFILE\fgn-deploys\
  so Dropbox sync doesn't fight with git operations. Do not move it
  under Dropbox.
#>

[CmdletBinding()]
param(
  [string]$DeployRoot = "$env:USERPROFILE\fgn-deploys",
  [string]$ToolkitRoot = "C:\Users\DML\Dropbox\Frictionless\AI\Claude\Code\Projects\exa-experiments\fgn-scorm-toolkit"
)

$ErrorActionPreference = 'Stop'

# --- Sanity ----------------------------------------------------------------
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($null -eq $gh) {
  Write-Host "ERROR: gh CLI not on PATH." -ForegroundColor Red
  exit 2
}

if (-not (Test-Path "$ToolkitRoot\supabase\functions\scorm-build\index.ts")) {
  Write-Host "ERROR: toolkit source not found at $ToolkitRoot" -ForegroundColor Red
  Write-Host "       Pass -ToolkitRoot if your toolkit checkout is elsewhere." -ForegroundColor Yellow
  exit 2
}

# --- Step 1: ensure clone exists, fetch latest -----------------------------
if (-not (Test-Path $DeployRoot)) {
  New-Item -ItemType Directory -Path $DeployRoot | Out-Null
  Write-Host "Created $DeployRoot" -ForegroundColor DarkGray
}

$clonePath = Join-Path $DeployRoot 'stratify-workforce'
if (-not (Test-Path $clonePath)) {
  Write-Host ""
  Write-Host "Cloning FGN2025/stratify-workforce to $clonePath ..." -ForegroundColor Cyan
  Push-Location $DeployRoot
  try {
    gh repo clone FGN2025/stratify-workforce
    if ($LASTEXITCODE -ne 0) {
      Write-Host "ERROR: gh repo clone failed." -ForegroundColor Red
      exit 1
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Host ""
  Write-Host "Pulling latest in $clonePath ..." -ForegroundColor Cyan
  Push-Location $clonePath
  try {
    git fetch origin main
    git checkout main
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) {
      Write-Host "ERROR: git pull failed (uncommitted changes?)." -ForegroundColor Red
      Write-Host "       Resolve manually in $clonePath, then re-run." -ForegroundColor Yellow
      exit 1
    }
  } finally {
    Pop-Location
  }
}

# --- Step 2: copy scorm-build directory tree -------------------------------
$srcDir = Join-Path $ToolkitRoot 'supabase\functions\scorm-build'
$destDir = Join-Path $clonePath 'supabase\functions\scorm-build'

Write-Host ""
Write-Host "Copying scorm-build directory tree:" -ForegroundColor Cyan
Write-Host "  source: $srcDir" -ForegroundColor DarkGray
Write-Host "  dest:   $destDir" -ForegroundColor DarkGray

# Wipe prior copy to ensure removed files don't linger
if (Test-Path $destDir) {
  Remove-Item -Recurse -Force $destDir
}
$destParent = Split-Path -Parent $destDir
if (-not (Test-Path $destParent)) {
  New-Item -ItemType Directory -Path $destParent -Force | Out-Null
}
Copy-Item -Recurse -Force $srcDir $destDir

$fileCount = (Get-ChildItem -Recurse -File $destDir | Measure-Object).Count
Write-Host "  copied $fileCount files" -ForegroundColor DarkGray

# --- Step 3: stage, commit, push -------------------------------------------
Push-Location $clonePath
try {
  git add supabase/functions/scorm-build
  $diff = git diff --cached --stat
  if (-not $diff) {
    Write-Host ""
    Write-Host "No changes vs. remote -- scorm-build is already up to date on stratify-workforce." -ForegroundColor Green
    Write-Host "Skipping commit + push. If Lovable hasn't deployed yet, ask it to redeploy." -ForegroundColor Yellow
    exit 0
  }

  Write-Host ""
  Write-Host "Diff staged:" -ForegroundColor Cyan
  Write-Host $diff
  Write-Host ""

  # Single-line commit message to dodge PowerShell here-string parsing
  # quirks. Detailed context lives in the toolkit repo's spec doc.
  git commit -m "Add scorm-build edge function (Phase 2 v0 step 3 from fgn-scorm-toolkit). Skeleton with auth + admin check + Work Order validation. Vendored toolkit source in _lib/ ready for step 4."
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git commit failed." -ForegroundColor Red
    exit 1
  }

  git push origin main
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push failed." -ForegroundColor Red
    exit 1
  }

  Write-Host ""
  Write-Host ("=" * 70) -ForegroundColor Green
  Write-Host "  Pushed to FGN2025/stratify-workforce main." -ForegroundColor Green
  Write-Host ("=" * 70) -ForegroundColor Green
} finally {
  Pop-Location
}

# --- Step 4: tell user what to ask Lovable ---------------------------------
Write-Host ""
Write-Host "Now ask Lovable (stratify-workforce chat) to redeploy:" -ForegroundColor White
Write-Host ""
Write-Host "  > Please redeploy the scorm-build edge function I just"  -ForegroundColor Gray
Write-Host "  > pushed to supabase/functions/scorm-build/. Confirm"     -ForegroundColor Gray
Write-Host "  > the function is reachable at"                           -ForegroundColor Gray
Write-Host "  > https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/scorm-build" -ForegroundColor Gray
Write-Host ""
