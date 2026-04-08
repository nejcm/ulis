$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$GeneratedDir = Join-Path $RootDir "generated"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

# Parse flags
$Backup = $args -contains "--backup"
$Rebuild = $args -contains "--rebuild"

Write-Host "`n━━━ AI Config Installer (Windows) ━━━" -ForegroundColor Cyan
Write-Host "Source: $GeneratedDir"
Write-Host ""

# Check prerequisites
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: bun is required (https://bun.sh)" -ForegroundColor Red; exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: git is required" -ForegroundColor Red; exit 1
}

# Build if generated/ doesn't exist or --rebuild flag passed
if (-not (Test-Path (Join-Path $GeneratedDir "opencode")) -or $Rebuild) {
    Write-Host "[build] Running build..." -ForegroundColor Yellow
    Push-Location $RootDir
    try {
        bun install --silent
        bun run build
    } finally {
        Pop-Location
    }
}

# Backup a directory if --backup was passed and the directory exists.
function Invoke-Backup {
    param([string]$Target)
    if ($Backup -and (Test-Path $Target)) {
        $name = Split-Path -Leaf $Target
        $parent = Split-Path -Parent $Target
        $backupPath = Join-Path $parent "$name.$Timestamp.backup"
        Copy-Item -Path $Target -Destination $backupPath -Recurse
        Write-Host "[backup] $Target -> $backupPath"
    }
}

# Copy all contents of a generated platform folder into a target directory.
# Pass an optional $Skip filename to exclude (handled separately by the caller).
function Copy-Platform {
    param(
        [string]$Src,
        [string]$Dest,
        [string]$Skip = ""
    )
    if (-not (Test-Path $Dest)) { New-Item -Path $Dest -ItemType Directory -Force | Out-Null }
    foreach ($item in Get-ChildItem -Path $Src) {
        if ($Skip -and $item.Name -eq $Skip) { continue }
        $destItem = Join-Path $Dest $item.Name
        if (Test-Path $destItem) { Remove-Item -Path $destItem -Recurse -Force }
        Copy-Item -Path $item.FullName -Destination $destItem -Recurse
        Write-Host "[done] $($item.Name)" -ForegroundColor Green
    }
}

# --- OpenCode ---
Write-Host "`n━━━ Installing OpenCode ━━━" -ForegroundColor Cyan
$OcTarget = if ($env:OPENCODE_CONFIG) { $env:OPENCODE_CONFIG } else { Join-Path $env:USERPROFILE ".opencode" }
Invoke-Backup -Target $OcTarget
if (Test-Path $OcTarget) { Remove-Item -Path $OcTarget -Recurse -Force }
Copy-Item -Path (Join-Path $GeneratedDir "opencode") -Destination $OcTarget -Recurse
Write-Host "[done] OpenCode -> $OcTarget" -ForegroundColor Green

# --- Claude Code ---
Write-Host "`n━━━ Installing Claude Code ━━━" -ForegroundColor Cyan
$CcTarget = Join-Path $env:USERPROFILE ".claude"
Invoke-Backup -Target $CcTarget

# Merge settings.json first (before bulk copy overwrites it)
$SettingsSrc = Join-Path $GeneratedDir "claude" "settings.json"
$SettingsDest = Join-Path $CcTarget "settings.json"
if (Test-Path $SettingsSrc) {
    if (Test-Path $SettingsDest) {
        $existing = Get-Content $SettingsDest -Raw | ConvertFrom-Json -AsHashtable
        $generated = Get-Content $SettingsSrc -Raw | ConvertFrom-Json -AsHashtable
        foreach ($key in $generated.Keys) {
            if ($existing.ContainsKey($key) -and $existing[$key] -is [hashtable] -and $generated[$key] -is [hashtable]) {
                foreach ($subKey in $generated[$key].Keys) { $existing[$key][$subKey] = $generated[$key][$subKey] }
            } else {
                $existing[$key] = $generated[$key]
            }
        }
        $existing | ConvertTo-Json -Depth 10 | Set-Content $SettingsDest -Encoding utf8NoBOM
        Write-Host "[done] settings.json (merged)" -ForegroundColor Green
    } else {
        if (-not (Test-Path $CcTarget)) { New-Item -Path $CcTarget -ItemType Directory -Force | Out-Null }
        Copy-Item -Path $SettingsSrc -Destination $SettingsDest
        Write-Host "[done] settings.json (copied)" -ForegroundColor Green
    }
}

# Copy everything else
Copy-Platform -Src (Join-Path $GeneratedDir "claude") -Dest $CcTarget -Skip "settings.json"

# Install marketplace plugins
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Host "[info] Installing Claude marketplace plugins..."
    try { claude plugin add --from affaan-m/everything-claude-code } catch { Write-Host "[warn] Failed to install everything-claude-code" -ForegroundColor Yellow }
    Write-Host "[done] Marketplace plugins" -ForegroundColor Green
} else {
    Write-Host "[skip] claude CLI not found - install plugins manually" -ForegroundColor Yellow
}

# --- Codex ---
Write-Host "`n━━━ Installing Codex ━━━" -ForegroundColor Cyan
$CxTarget = Join-Path $env:USERPROFILE ".codex"
Invoke-Backup -Target $CxTarget
Copy-Platform -Src (Join-Path $GeneratedDir "codex") -Dest $CxTarget

# --- Cursor ---
Write-Host "`n━━━ Installing Cursor ━━━" -ForegroundColor Cyan
$CrTarget = Join-Path $env:USERPROFILE ".cursor"
Invoke-Backup -Target $CrTarget

# Merge mcp.json first (before bulk copy overwrites it)
$CrSrc = Join-Path $GeneratedDir "cursor" "mcp.json"
$CrConfig = Join-Path $CrTarget "mcp.json"
if (Test-Path $CrSrc) {
    if (Test-Path $CrConfig) {
        $existing = Get-Content $CrConfig -Raw | ConvertFrom-Json -AsHashtable
        $generated = Get-Content $CrSrc -Raw | ConvertFrom-Json -AsHashtable
        if (-not $existing.ContainsKey("mcpServers")) { $existing["mcpServers"] = @{} }
        foreach ($key in $generated["mcpServers"].Keys) { $existing["mcpServers"][$key] = $generated["mcpServers"][$key] }
        $existing | ConvertTo-Json -Depth 10 | Set-Content $CrConfig -Encoding utf8NoBOM
        Write-Host "[done] mcp.json (merged)" -ForegroundColor Green
    } else {
        if (-not (Test-Path $CrTarget)) { New-Item -Path $CrTarget -ItemType Directory -Force | Out-Null }
        Copy-Item -Path $CrSrc -Destination $CrConfig
        Write-Host "[done] mcp.json (copied)" -ForegroundColor Green
    }
}

# Copy everything else
Copy-Platform -Src (Join-Path $GeneratedDir "cursor") -Dest $CrTarget -Skip "mcp.json"

# --- Summary ---
Write-Host "`n━━━ Installation Complete ━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "Required environment variables:" -ForegroundColor Yellow
Write-Host "  GITHUB_PAT          - GitHub Personal Access Token"
Write-Host "  CONTEXT7_API_KEY    - Context7 API Key"
Write-Host "  LINEAR_API_KEY      - Linear API Key"
Write-Host ""
Write-Host "Verify with: echo `$env:GITHUB_PAT `$env:CONTEXT7_API_KEY `$env:LINEAR_API_KEY"
