<#
.SYNOPSIS
  Phase 1.4 v0 bootstrap — install + typecheck + build the new
  @fgn/course-enhancer package and its consumer @fgn/scorm-builder.

.DESCRIPTION
  Runs the three "no API spend" steps in sequence with clean error
  handling and a status summary at the end:
    1. pnpm install            (pulls @anthropic-ai/sdk, links workspace)
    2. pnpm -r typecheck       (every package compiles)
    3. pnpm build (in order)   (course-types -> course-enhancer -> scorm-builder)
    4. Apply Dropbox-ignore to packages/course-enhancer/{node_modules,dist}

  Stops on the first failure and prints what to do next. Re-runnable —
  pnpm install is incremental, typecheck and build are no-ops on a
  green tree.

.NOTES
  Run from the toolkit root, e.g.
    cd C:\Users\DML\Dropbox\Frictionless\AI\Claude\Code\Projects\exa-experiments\fgn-scorm-toolkit
    .\scripts\phase-1.4-bootstrap.ps1

  Skip the Dropbox-ignore step (e.g. on a non-Dropbox checkout) with:
    .\scripts\phase-1.4-bootstrap.ps1 -SkipDropboxIgnore

  Emits no API requests. Run scripts\phase-1.4-smoke.ps1 (separately)
  for the dry-run + real-enhance flow once this is green.
#>

[CmdletBinding()]
param(
  [switch]$SkipDropboxIgnore
)

$ErrorActionPreference = 'Stop'

# --- Sanity: are we at the toolkit root? -----------------------------------
$expectedFiles = @('pnpm-workspace.yaml', 'tsconfig.base.json', 'packages\course-enhancer')
foreach ($f in $expectedFiles) {
  if (-not (Test-Path $f)) {
    Write-Host ""
    Write-Host "ERROR: $f not found in $PWD" -ForegroundColor Red
    Write-Host "       Run this script from the toolkit root:" -ForegroundColor Red
    Write-Host "         cd C:\Users\DML\Dropbox\Frictionless\AI\Claude\Code\Projects\exa-experiments\fgn-scorm-toolkit" -ForegroundColor Red
    exit 2
  }
}

# --- Sanity: pnpm available? -----------------------------------------------
$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if ($null -eq $pnpmCmd) {
  Write-Host ""
  Write-Host "ERROR: 'pnpm' not on PATH." -ForegroundColor Red
  Write-Host "       Install via 'npm install -g pnpm' or 'corepack enable'." -ForegroundColor Red
  exit 2
}

function Step($n, $label) {
  Write-Host ""
  Write-Host ("=" * 70) -ForegroundColor DarkCyan
  Write-Host "  Step $n -- $label" -ForegroundColor Cyan
  Write-Host ("=" * 70) -ForegroundColor DarkCyan
}

# --- Step 1: install --------------------------------------------------------
Step 1 "pnpm install (pulls @anthropic-ai/sdk, links @fgn/course-enhancer)"
pnpm install
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "FAIL: pnpm install exited $LASTEXITCODE." -ForegroundColor Red
  Write-Host "      Most common cause: @anthropic-ai/sdk@^0.40.0 unavailable." -ForegroundColor Yellow
  Write-Host "      Fix: bump the version in packages/course-enhancer/package.json" -ForegroundColor Yellow
  Write-Host "           to whatever 'npm view @anthropic-ai/sdk version' returns," -ForegroundColor Yellow
  Write-Host "           then re-run this script." -ForegroundColor Yellow
  exit 1
}

# --- Step 2: build all FGN packages in dependency order --------------------
# Workspace consumers read each package's compiled dist/index.d.ts, so
# every package must be built BEFORE downstream packages can typecheck
# against it. Order:
#   course-types     (schema authority — produces aiEnhanced field)
#   course-enhancer  (depends on course-types)
#   scorm-builder    (depends on course-enhancer + course-types)
# tsc emits AND typechecks, so a successful build is equivalent to a
# typecheck of that package against its already-built deps.
Step 2 "pnpm build (course-types -> course-enhancer -> scorm-builder)"
$buildOrder = @(
  '@fgn/course-types',
  '@fgn/course-enhancer',
  '@fgn/scorm-builder'
)
foreach ($pkg in $buildOrder) {
  Write-Host ""
  Write-Host "  -> building $pkg" -ForegroundColor DarkGray
  pnpm --filter $pkg build
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "FAIL: build of $pkg exited $LASTEXITCODE." -ForegroundColor Red
    Write-Host "      Paste the error block above to Claude and we'll fix it." -ForegroundColor Yellow
    Write-Host "      Common culprits:" -ForegroundColor Yellow
    Write-Host "        - SDK type drift on a newer @anthropic-ai/sdk" -ForegroundColor Yellow
    Write-Host "        - exactOptionalPropertyTypes on the new aiEnhanced field" -ForegroundColor Yellow
    Write-Host "        - downstream package consumed an unbuilt workspace dep" -ForegroundColor Yellow
    exit 1
  }
}

# --- Step 3: workspace typecheck sweep -------------------------------------
# Sanity sweep across every package, including ones outside the build
# graph above (brand-tokens, academy-publisher, scorm-player). Should
# be a no-op for the three we just built, but catches regressions in
# the rest.
Step 3 "pnpm -r typecheck (sanity sweep across the whole workspace)"
pnpm -r typecheck
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "FAIL: typecheck failed." -ForegroundColor Red
  Write-Host "      Paste the error block above to Claude and we'll fix it." -ForegroundColor Yellow
  exit 1
}

# --- Step 5: Dropbox-ignore the new directories ----------------------------
if ($SkipDropboxIgnore) {
  Step 5 "Dropbox-ignore (skipped via -SkipDropboxIgnore)"
} else {
  Step 5 "Dropbox-ignore packages/course-enhancer/{node_modules,dist}"
  $targets = @(
    'packages\course-enhancer\node_modules',
    'packages\course-enhancer\dist'
  )
  foreach ($t in $targets) {
    if (-not (Test-Path $t)) {
      Write-Host "  (skip, not present): $t" -ForegroundColor DarkGray
      continue
    }
    try {
      Set-Content -Path $t -Stream com.dropbox.ignored -Value 1 -ErrorAction Stop
      Write-Host "  ignored: $t" -ForegroundColor Green
    } catch {
      Write-Host "  WARN: could not set ignore stream on ${t}: $($_.Exception.Message)" -ForegroundColor Yellow
      Write-Host "        (non-fatal -- Dropbox will sync these dirs until manually ignored)" -ForegroundColor Yellow
    }
  }
}

# --- Summary ---------------------------------------------------------------
Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Green
Write-Host "  Phase 1.4 v0 bootstrap: GREEN" -ForegroundColor Green
Write-Host ("=" * 70) -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    a) Dry-run smoke test (no API spend):" -ForegroundColor White
Write-Host "         node packages\scorm-builder\dist\cli.js enhance ``" -ForegroundColor Gray
Write-Host "           .\acceptance\gold-challenge-v15.json ``" -ForegroundColor Gray
Write-Host "           --out .\acceptance\gold-challenge-v15.enhanced.json ``" -ForegroundColor Gray
Write-Host "           --dry-run" -ForegroundColor Gray
Write-Host ""
Write-Host "    b) Get an Anthropic API key from console.anthropic.com," -ForegroundColor White
Write-Host "       set `$env:ANTHROPIC_API_KEY in this shell (NOT in any file)," -ForegroundColor White
Write-Host "       then run the same command without --dry-run." -ForegroundColor White
Write-Host ""
Write-Host "    c) Tell Claude 'bootstrap green' so it can run the output review." -ForegroundColor White
Write-Host ""
