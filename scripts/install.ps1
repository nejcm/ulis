$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$GeneratedDir = Join-Path $RootDir "generated"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

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
if (-not (Test-Path (Join-Path $GeneratedDir "opencode")) -or ($args -contains "--rebuild")) {
    Write-Host "[build] Running build..." -ForegroundColor Yellow
    Push-Location $RootDir
    try {
        bun install --silent
        bun run build
    } finally {
        Pop-Location
    }
}

# --- OpenCode ---
Write-Host "`n━━━ Installing OpenCode ━━━" -ForegroundColor Cyan
$OcTarget = if ($env:OPENCODE_CONFIG) { $env:OPENCODE_CONFIG } else { Join-Path $env:USERPROFILE ".opencode" }
if (Test-Path $OcTarget) {
    $BackupPath = "$OcTarget.backup.$Timestamp"
    Write-Host "[backup] $OcTarget -> $BackupPath"
    Copy-Item -Path $OcTarget -Destination $BackupPath -Recurse
}
if (Test-Path $OcTarget) { Remove-Item -Path $OcTarget -Recurse -Force }
Copy-Item -Path (Join-Path $GeneratedDir "opencode") -Destination $OcTarget -Recurse
Write-Host "[done] OpenCode -> $OcTarget" -ForegroundColor Green

# --- Claude Code ---
Write-Host "`n━━━ Installing Claude Code ━━━" -ForegroundColor Cyan
$CcTarget = Join-Path $env:USERPROFILE ".claude"
if (-not (Test-Path $CcTarget)) { New-Item -Path $CcTarget -ItemType Directory -Force | Out-Null }

# Merge settings.json
$SettingsSrc = Join-Path $GeneratedDir "claude" "settings.json"
$SettingsDest = Join-Path $CcTarget "settings.json"
if (Test-Path $SettingsSrc) {
    if (Test-Path $SettingsDest) {
        # Simple merge: read both, combine, write
        $existing = Get-Content $SettingsDest -Raw | ConvertFrom-Json -AsHashtable
        $generated = Get-Content $SettingsSrc -Raw | ConvertFrom-Json -AsHashtable
        foreach ($key in $generated.Keys) {
            if ($existing.ContainsKey($key) -and $existing[$key] -is [hashtable] -and $generated[$key] -is [hashtable]) {
                foreach ($subKey in $generated[$key].Keys) {
                    $existing[$key][$subKey] = $generated[$key][$subKey]
                }
            } else {
                $existing[$key] = $generated[$key]
            }
        }
        $existing | ConvertTo-Json -Depth 10 | Set-Content $SettingsDest -Encoding utf8NoBOM
        Write-Host "[done] settings.json (merged)" -ForegroundColor Green
    } else {
        Copy-Item -Path $SettingsSrc -Destination $SettingsDest
        Write-Host "[done] settings.json (copied)" -ForegroundColor Green
    }
}

# Copy agents, commands, rules, AGENTS.md (replace)
foreach ($item in @("agents", "commands", "rules", "AGENTS.md")) {
    $src = Join-Path $GeneratedDir "claude" $item
    if (Test-Path $src) {
        $dest = Join-Path $CcTarget $item
        if (Test-Path $dest) { Remove-Item -Path $dest -Recurse -Force }
        Copy-Item -Path $src -Destination $dest -Recurse
        Write-Host "[done] $item" -ForegroundColor Green
    }
}

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
if (-not (Test-Path $CxTarget)) { New-Item -Path $CxTarget -ItemType Directory -Force | Out-Null }
$CxConfig = Join-Path $CxTarget "config.toml"
if (Test-Path $CxConfig) {
    Copy-Item -Path $CxConfig -Destination "$CxConfig.backup.$Timestamp"
    Write-Host "[backup] config.toml"
}
Copy-Item -Path (Join-Path $GeneratedDir "codex" "config.toml") -Destination $CxConfig -Force
Write-Host "[done] config.toml" -ForegroundColor Green

# Copy agents, skills, AGENTS.md (replace)
foreach ($item in @("agents", "skills", "AGENTS.md")) {
    $src = Join-Path $GeneratedDir "codex" $item
    if (Test-Path $src) {
        $dest = Join-Path $CxTarget $item
        if (Test-Path $dest) { Remove-Item -Path $dest -Recurse -Force }
        Copy-Item -Path $src -Destination $dest -Recurse
        Write-Host "[done] $item" -ForegroundColor Green
    }
}

# --- Cursor ---
Write-Host "`n━━━ Installing Cursor ━━━" -ForegroundColor Cyan
$CrTarget = Join-Path $env:USERPROFILE ".cursor"
if (-not (Test-Path $CrTarget)) { New-Item -Path $CrTarget -ItemType Directory -Force | Out-Null }
$CrConfig = Join-Path $CrTarget "mcp.json"
$CrSrc = Join-Path $GeneratedDir "cursor" "mcp.json"
if (Test-Path $CrConfig) {
    $existing = Get-Content $CrConfig -Raw | ConvertFrom-Json -AsHashtable
    $generated = Get-Content $CrSrc -Raw | ConvertFrom-Json -AsHashtable
    if (-not $existing.ContainsKey("mcpServers")) { $existing["mcpServers"] = @{} }
    foreach ($key in $generated["mcpServers"].Keys) {
        $existing["mcpServers"][$key] = $generated["mcpServers"][$key]
    }
    $existing | ConvertTo-Json -Depth 10 | Set-Content $CrConfig -Encoding utf8NoBOM
    Write-Host "[done] mcp.json (merged)" -ForegroundColor Green
} else {
    Copy-Item -Path $CrSrc -Destination $CrConfig
    Write-Host "[done] mcp.json (copied)" -ForegroundColor Green
}

# Copy skills, AGENTS.md (replace)
foreach ($item in @("skills", "AGENTS.md")) {
    $src = Join-Path $GeneratedDir "cursor" $item
    if (Test-Path $src) {
        $dest = Join-Path $CrTarget $item
        if (Test-Path $dest) { Remove-Item -Path $dest -Recurse -Force }
        Copy-Item -Path $src -Destination $dest -Recurse
        Write-Host "[done] $item" -ForegroundColor Green
    }
}

# --- Summary ---
Write-Host "`n━━━ Installation Complete ━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "Required environment variables:" -ForegroundColor Yellow
Write-Host "  GITHUB_PAT          - GitHub Personal Access Token"
Write-Host "  CONTEXT7_API_KEY    - Context7 API Key"
Write-Host "  LINEAR_API_KEY      - Linear API Key"
Write-Host ""
Write-Host "Verify with: echo `$env:GITHUB_PAT `$env:CONTEXT7_API_KEY `$env:LINEAR_API_KEY"
