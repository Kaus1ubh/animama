<#
.SYNOPSIS
Run the Windows fresh-account smoke for a signed Animama candidate.

.DESCRIPTION
The owner runs this once, signed in to a separate standard Windows account that
has never run Animama. It checks the account and toolchain, loads the smoke
OpenAI key from an owner-only file without printing it, and runs
`pnpm desktop:smoke:windows` against the signed installer in the build
account's release checkout. The reports land in that checkout's
desktop/release/smoke-name/ folder, where the build account's publisher reads
them.

The smoke makes two short real OpenAI chat calls with that key. It removes the
temporary credential from the app's vault before it finishes.

.PARAMETER Checkout
The release checkout. Defaults to the nearest folder above this script that
holds src\frontend\desktop\package.json.

.PARAMETER KeyFile
A file in this account holding the line ANIMAMA_SMOKE_OPENAI_KEY=<key>.
Defaults to %USERPROFILE%\.config\animama\smoke-openai.env.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File <checkout>\.animama-drafts\desktop-release\smoke-windows-account.ps1
#>
param(
  [string] $Checkout,
  [string] $KeyFile = (Join-Path $env:USERPROFILE '.config\animama\smoke-openai.env')
)

$ErrorActionPreference = 'Stop'

function Stop-Smoke([string] $Message) {
  Write-Host "Smoke not started: $Message" -ForegroundColor Red
  exit 1
}

# Started from PowerShell 7, child Windows PowerShell 5.1 processes inherit a
# module path whose Microsoft.PowerShell.Security cannot load (Get-Acl,
# Get-AuthenticodeSignature). Use the machine's own module path.
$env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')

# A standard account: no Administrators membership, even as a deny-only group
# in a non-elevated token.
$groups = whoami /groups /fo csv | ConvertFrom-Csv
if ($groups | Where-Object { $_.SID -eq 'S-1-5-32-544' }) {
  Stop-Smoke 'this account is an administrator. Sign in to a standard account.'
}

# The smoke refuses a profile with earlier Animama data; it never resets one.
$existing = @(
  (Join-Path $env:LOCALAPPDATA 'Animama'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Animama'),
  (Join-Path $env:APPDATA 'Animama'),
  (Join-Path $env:APPDATA 'Anima')
) | Where-Object { Test-Path -LiteralPath $_ }
if ($existing) {
  Stop-Smoke ("this account already has Animama data. Move these aside (rename them; never delete them), or use a new account:`n  " + ($existing -join "`n  "))
}

# Locate the checkout and the candidate.
if (-not $Checkout) {
  $dir = $PSScriptRoot
  while ($dir -and -not (Test-Path -LiteralPath (Join-Path $dir 'src\frontend\desktop\package.json'))) {
    $dir = Split-Path -Parent $dir
  }
  if (-not $dir) { Stop-Smoke 'pass -Checkout <release checkout>.' }
  $Checkout = $dir
}
$frontend = Join-Path $Checkout 'src\frontend'
$desktop = Join-Path $frontend 'desktop'
if (-not (Test-Path -LiteralPath (Join-Path $desktop 'node_modules'))) {
  Stop-Smoke "$desktop has no installed dependencies, or this account cannot read it."
}
$version = (Get-Content -Raw -LiteralPath (Join-Path $desktop 'package.json') | ConvertFrom-Json).version
$artifact = "desktop/release/publish/Animama-$version-x64-setup.exe"
if (-not (Test-Path -LiteralPath (Join-Path $frontend $artifact))) { Stop-Smoke "the signed installer is missing: $artifact" }
$reports = Join-Path $desktop 'release\smoke-name'
if (Test-Path -LiteralPath $reports) { Stop-Smoke "$reports already exists. Ask the build account to move it aside." }
try {
  $probe = Join-Path $desktop "release\.smoke-write-probe-$PID"
  New-Item -ItemType File -Path $probe | Out-Null
  Remove-Item -LiteralPath $probe
} catch { Stop-Smoke "this account cannot write to $(Join-Path $desktop 'release')." }

# Toolchain: the system Node.js 24 and the pinned pnpm through Corepack.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Stop-Smoke 'Node.js 24 is not on PATH.' }
$nodeVersion = & node --version
if ($nodeVersion -notmatch '^v24\.') { Stop-Smoke "Node.js 24 is required; found $nodeVersion." }
$pinned = ((Get-Content -Raw -LiteralPath (Join-Path $frontend 'package.json') | ConvertFrom-Json).packageManager -replace '^pnpm@', '')
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
Push-Location -LiteralPath $frontend
try { $pnpmVersion = (& pnpm --version) 2>$null } catch { $pnpmVersion = $null } finally { Pop-Location }
if ($pnpmVersion -ne $pinned) { Stop-Smoke "pnpm $pinned is required (Corepack); found '$pnpmVersion'. Run 'corepack enable' as an administrator once." }

# The key: read one variable from this account's owner-only file. It is never
# printed, and only this process and the smoke it starts can see it.
if (-not (Test-Path -LiteralPath $KeyFile)) {
  Stop-Smoke "the key file is missing: $KeyFile. Put an owner-only copy of smoke-openai.env there, or pass -KeyFile."
}
$key = $null
foreach ($line in Get-Content -LiteralPath $KeyFile) {
  if ($line -match '^\s*(?:export\s+)?ANIMAMA_SMOKE_OPENAI_KEY\s*=\s*(.*?)\s*$') {
    $key = $Matches[1] -replace '^"(.*)"$', '$1' -replace "^'(.*)'$", '$1'
  }
}
if (-not $key) { Stop-Smoke "$KeyFile has no ANIMAMA_SMOKE_OPENAI_KEY line." }

Write-Host "Animama $version smoke in account $env:USERNAME"
Write-Host "Checkout:  $Checkout"
Write-Host "Installer: $artifact"
$status = 1
try {
  $env:ANIMAMA_SMOKE_OPENAI_KEY = $key
  Push-Location -LiteralPath $frontend
  try {
    & pnpm desktop:smoke:windows -- --artifact $artifact --setup name
    $status = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item Env:\ANIMAMA_SMOKE_OPENAI_KEY -ErrorAction SilentlyContinue
  $key = $null
}

$report = Join-Path $reports 'smoke-report.json'
if (Test-Path -LiteralPath $report) {
  $result = Get-Content -Raw -LiteralPath $report | ConvertFrom-Json
  Write-Host "passed: $($result.passed)  installer_sha256: $($result.installer_sha256)  runtime_build_id: $($result.runtime_build_id)"
}
if ($status -ne 0) {
  Write-Host "Smoke failed (exit $status). Tell the build account which step failed; rerun with ANIMAMA_SMOKE_DEBUG=1 only to see the error yourself." -ForegroundColor Red
  exit $status
}
Write-Host 'Smoke passed. The installed app stays in this account for inspection.' -ForegroundColor Green
