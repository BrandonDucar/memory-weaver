$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22.13 or newer is required. Install Node.js, then run this installer again."
}

$versionText = node --version
$major = [int](($versionText -replace '^v', '').Split('.')[0])
if ($major -lt 22) {
  throw "Memory Weaver requires Node.js 22.13 or newer. Found $versionText."
}

Push-Location $root
try {
  npm install --omit=dev
  & node "$root\dist\index.js" init
  Write-Host "Memory Weaver Local is ready."
  Write-Host "Edit $HOME\.memory-weaver\mesh.config.json to enable only the sources you choose."
  Write-Host "Then run: $root\memory-weaver.cmd scan"
} finally {
  Pop-Location
}
