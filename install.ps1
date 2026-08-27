#requires -Version 5.1
# Windows installer. Fetches the tree if needed, then runs scripts/install.mjs.
# Does not use npm.
[CmdletBinding()]
param(
    [string] $Prefix = $(if ($env:PREFIX) { $env:PREFIX } else { Join-Path $HOME ".local" }),
    [switch] $Uninstall
)

$ErrorActionPreference = "Stop"
$Repo = "joshuaboys/steward"
$Ref = $(if ($env:STEWARD_REF) { $env:STEWARD_REF } else { "main" })
$Lib = $(if ($env:STEWARD_LIB) { $env:STEWARD_LIB } else { Join-Path $Prefix "lib\steward" })
$BinDir = Join-Path $Prefix "bin"

function Test-StewardTree {
    param([string] $Dir)
    return (Test-Path (Join-Path $Dir "bin\steward.mjs")) -and
        (Test-Path (Join-Path $Dir "src\steward\cli\main.ts")) -and
        (Test-Path (Join-Path $Dir "wrangler.jsonc"))
}

if ($Uninstall) {
    if (Test-Path $Lib) {
        Remove-Item -Recurse -Force $Lib
    }
    Remove-Item -Force (Join-Path $BinDir "steward") -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $BinDir "steward.cmd") -ErrorAction SilentlyContinue
    Write-Host "removed $Lib and wrappers in $BinDir"
    exit 0
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error "steward needs Node 22.12 or later (node not found on PATH)."
    exit 1
}
$ver = (& node -v).Trim()
if ($ver.StartsWith("v")) { $ver = $ver.Substring(1) }
$parts = $ver.Split(".")
$major = [int]$parts[0]
$minor = [int]$parts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 12)) {
    Write-Error "steward needs Node 22.12 or later (found $ver)."
    exit 1
}

function Resolve-StewardSrc {
    if ($env:STEWARD_SRC) {
        if (Test-StewardTree $env:STEWARD_SRC) { return $env:STEWARD_SRC }
        throw "STEWARD_SRC is not a steward tree: $($env:STEWARD_SRC)"
    }
    if ($PSScriptRoot -and (Test-StewardTree $PSScriptRoot)) {
        return $PSScriptRoot
    }
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "steward-src-$PID"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zip = Join-Path $tmp "src.zip"
    $url = "https://github.com/$Repo/archive/$Ref.zip"
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
    $extract = Join-Path $tmp "src"
    Expand-Archive -Path $zip -DestinationPath $extract
    $found = Get-ChildItem $extract -Directory | Select-Object -First 1
    if (-not $found -or -not (Test-StewardTree $found.FullName)) {
        throw "downloaded archive from $url was not a steward tree."
    }
    return $found.FullName
}

$src = Resolve-StewardSrc
$installer = Join-Path $src "scripts\install.mjs"
& node $installer --prefix $Prefix
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -eq $userPath) { $userPath = "" }
if ($userPath -notlike "*${BinDir}*") {
    [Environment]::SetEnvironmentVariable("Path", "$BinDir;$userPath", "User")
    $env:Path = "$BinDir;$env:Path"
    Write-Host "Added $BinDir to your user PATH. Open a new terminal, then: steward help"
}
