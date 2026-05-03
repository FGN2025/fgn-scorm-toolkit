<#
.SYNOPSIS
  Set ANTHROPIC_API_KEY and OPENAI_API_KEY for the current PowerShell
  session. Used as part of the @fgn/course-enhancer enhance flow.

.DESCRIPTION
  Both keys are captured via Read-Host -AsSecureString so the values
  never echo to the screen and don't end up in the PowerShell command
  history. The keys live ONLY in the current session — closing this
  window clears them.

  Skip a key by pressing Enter at its prompt (e.g., skip OpenAI if
  you only need the Anthropic text slots).

.NOTES
  Run from the toolkit root or anywhere — env vars are set
  process-scope so the values are visible to any child process
  launched from this same PowerShell window.

  Compatible with Windows PowerShell 5.1 and PowerShell 7+.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Set-ApiKey {
  param(
    [Parameter(Mandatory)] [string] $EnvName,
    [Parameter(Mandatory)] [string] $DisplayName
  )

  Write-Host ""
  $secure = Read-Host -AsSecureString -Prompt "Paste $DisplayName API key (Enter to skip)"
  if ($null -eq $secure -or $secure.Length -eq 0) {
    Write-Host "  $DisplayName key skipped." -ForegroundColor Yellow
    return
  }

  $cred = [PSCredential]::new('x', $secure)
  $value = $cred.GetNetworkCredential().Password
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Host "  $DisplayName key was empty." -ForegroundColor Yellow
    return
  }

  Set-Item -Path "Env:\$EnvName" -Value $value
}

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor DarkCyan
Write-Host "  Set FGN SCORM toolkit API keys for this session" -ForegroundColor Cyan
Write-Host ("=" * 70) -ForegroundColor DarkCyan
Write-Host ""
Write-Host "Each prompt waits for you to paste the key. Asterisks will" -ForegroundColor Gray
Write-Host "appear as you paste -- the value never echoes to the screen." -ForegroundColor Gray
Write-Host "Press Enter without pasting anything to skip a given key." -ForegroundColor Gray

Set-ApiKey -EnvName 'ANTHROPIC_API_KEY' -DisplayName 'Anthropic'
Set-ApiKey -EnvName 'OPENAI_API_KEY' -DisplayName 'OpenAI'

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor Green
Write-Host "  Status:" -ForegroundColor Green
Write-Host ("=" * 70) -ForegroundColor Green
$anth = if ($env:ANTHROPIC_API_KEY) { "set, length=$($env:ANTHROPIC_API_KEY.Length)" } else { "NOT SET" }
$oai  = if ($env:OPENAI_API_KEY)    { "set, length=$($env:OPENAI_API_KEY.Length)"    } else { "NOT SET" }
Write-Host ("  anthropic: {0}" -f $anth) -ForegroundColor White
Write-Host ("  openai:    {0}" -f $oai)  -ForegroundColor White
Write-Host ""
Write-Host "Both keys live only in this PowerShell session. Closing the" -ForegroundColor Gray
Write-Host "window clears them. Run this script again next session." -ForegroundColor Gray
Write-Host ""
