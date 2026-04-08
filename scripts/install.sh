#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GENERATED_DIR="$ROOT_DIR/generated"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Parse flags
BACKUP=false
REBUILD=false
for arg in "$@"; do
  case "$arg" in
    --backup)  BACKUP=true ;;
    --rebuild) REBUILD=true ;;
  esac
done

echo "━━━ AI Config Installer (Linux/macOS) ━━━"
echo "Source: $GENERATED_DIR"
echo ""

# Check prerequisites
command -v bun >/dev/null 2>&1 || { echo "ERROR: bun is required (https://bun.sh)"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: git is required"; exit 1; }

# Build if generated/ doesn't exist or --rebuild flag passed
if [ ! -d "$GENERATED_DIR/opencode" ] || [ "$REBUILD" = true ]; then
  echo "[build] Running build..."
  (cd "$ROOT_DIR" && bun install --silent && bun run build)
fi

# Backup a directory if --backup was passed and the directory exists.
maybe_backup() {
  local target="$1"
  if [ "$BACKUP" = true ] && [ -d "$target" ]; then
    local name
    name="$(basename "$target")"
    local backup_path
    backup_path="$(dirname "$target")/$name.$TIMESTAMP.backup"
    cp -r "$target" "$backup_path"
    echo "[backup] $target -> $backup_path"
  fi
}

# Copy all contents of a generated platform folder into a target directory.
# Files that need special merge handling (settings.json, mcp.json) are skipped
# here and handled separately; everything else is copied as-is.
copy_platform() {
  local src="$1"   # generated/<platform>/
  local dest="$2"  # system target dir
  local skip="${3:-}"  # optional filename to skip (handled by caller)

  mkdir -p "$dest"
  for item in "$src"/*; do
    [ -e "$item" ] || continue
    local name
    name="$(basename "$item")"
    [ "$name" = "$skip" ] && continue
    rm -rf "$dest/$name"
    cp -r "$item" "$dest/$name"
    echo "[done] $name"
  done
}

# --- OpenCode ---
echo ""
echo "━━━ Installing OpenCode ━━━"
OC_TARGET="${OPENCODE_CONFIG:-$HOME/.opencode}"
maybe_backup "$OC_TARGET"
rm -rf "$OC_TARGET"
cp -r "$GENERATED_DIR/opencode" "$OC_TARGET"
chmod +x "$OC_TARGET/scripts/"*.sh 2>/dev/null || true
echo "[done] OpenCode -> $OC_TARGET"

# --- Claude Code ---
echo ""
echo "━━━ Installing Claude Code ━━━"
CC_TARGET="$HOME/.claude"
maybe_backup "$CC_TARGET"

# Merge settings.json first (before bulk copy overwrites it)
if [ -f "$GENERATED_DIR/claude/settings.json" ]; then
  if command -v jq >/dev/null 2>&1 && [ -f "$CC_TARGET/settings.json" ]; then
    jq -s '.[0] * .[1]' "$CC_TARGET/settings.json" "$GENERATED_DIR/claude/settings.json" > "$CC_TARGET/settings.json.tmp"
    mv "$CC_TARGET/settings.json.tmp" "$CC_TARGET/settings.json"
    echo "[done] settings.json (merged)"
  else
    cp "$GENERATED_DIR/claude/settings.json" "$CC_TARGET/settings.json"
    echo "[done] settings.json (copied)"
  fi
fi

# Copy everything else
copy_platform "$GENERATED_DIR/claude" "$CC_TARGET" "settings.json"

# Install marketplace plugins (if claude CLI available)
if command -v claude >/dev/null 2>&1; then
  echo "[info] Installing Claude marketplace plugins..."
  claude plugin add --from affaan-m/everything-claude-code 2>/dev/null || echo "[warn] Failed to install everything-claude-code"
  echo "[done] Marketplace plugins"
else
  echo "[skip] claude CLI not found - install plugins manually"
fi

# --- Codex ---
echo ""
echo "━━━ Installing Codex ━━━"
CX_TARGET="$HOME/.codex"
maybe_backup "$CX_TARGET"
copy_platform "$GENERATED_DIR/codex" "$CX_TARGET"

# --- Cursor ---
echo ""
echo "━━━ Installing Cursor ━━━"
CR_TARGET="$HOME/.cursor"
maybe_backup "$CR_TARGET"

# Merge mcp.json first (before bulk copy overwrites it)
if [ -f "$GENERATED_DIR/cursor/mcp.json" ]; then
  if command -v jq >/dev/null 2>&1 && [ -f "$CR_TARGET/mcp.json" ]; then
    jq -s '{ mcpServers: (.[0].mcpServers // {}) * (.[1].mcpServers // {}) }' \
      "$CR_TARGET/mcp.json" "$GENERATED_DIR/cursor/mcp.json" > "$CR_TARGET/mcp.json.tmp"
    mv "$CR_TARGET/mcp.json.tmp" "$CR_TARGET/mcp.json"
    echo "[done] mcp.json (merged)"
  else
    cp "$GENERATED_DIR/cursor/mcp.json" "$CR_TARGET/mcp.json"
    echo "[done] mcp.json (copied)"
  fi
fi

# Copy everything else
copy_platform "$GENERATED_DIR/cursor" "$CR_TARGET" "mcp.json"

# --- Summary ---
echo ""
echo "━━━ Installation Complete ━━━"
echo ""
echo "Required environment variables:"
echo "  GITHUB_PAT          - GitHub Personal Access Token"
echo "  CONTEXT7_API_KEY    - Context7 API Key"
echo "  LINEAR_API_KEY      - Linear API Key"
echo ""
echo "Verify with: echo \$GITHUB_PAT \$CONTEXT7_API_KEY \$LINEAR_API_KEY"
