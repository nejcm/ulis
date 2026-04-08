#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GENERATED_DIR="$ROOT_DIR/generated"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "━━━ AI Config Installer (Linux/macOS) ━━━"
echo "Source: $GENERATED_DIR"
echo ""

# Check prerequisites
command -v bun >/dev/null 2>&1 || { echo "ERROR: bun is required (https://bun.sh)"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: git is required"; exit 1; }

# Build if generated/ doesn't exist or --rebuild flag passed
if [ ! -d "$GENERATED_DIR/opencode" ] || [ "${1:-}" = "--rebuild" ]; then
  echo "[build] Running build..."
  (cd "$ROOT_DIR" && bun install --silent && bun run build)
fi

# --- OpenCode ---
echo ""
echo "━━━ Installing OpenCode ━━━"
OC_TARGET="${OPENCODE_CONFIG:-$HOME/.opencode}"
if [ -d "$OC_TARGET" ]; then
  echo "[backup] $OC_TARGET -> $OC_TARGET.backup.$TIMESTAMP"
  cp -r "$OC_TARGET" "$OC_TARGET.backup.$TIMESTAMP"
fi
rm -rf "$OC_TARGET"
cp -r "$GENERATED_DIR/opencode" "$OC_TARGET"
chmod +x "$OC_TARGET/scripts/"*.sh 2>/dev/null || true
echo "[done] OpenCode -> $OC_TARGET"

# --- Claude Code ---
echo ""
echo "━━━ Installing Claude Code ━━━"
CC_TARGET="$HOME/.claude"
mkdir -p "$CC_TARGET"

# Merge settings.json (additive merge using jq if available)
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

# Copy agents, commands, rules, AGENTS.md (replace)
for item in agents commands rules AGENTS.md; do
  src="$GENERATED_DIR/claude/$item"
  if [ -e "$src" ]; then
    rm -rf "$CC_TARGET/$item"
    cp -r "$src" "$CC_TARGET/$item"
    echo "[done] $item"
  fi
done

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
mkdir -p "$CX_TARGET"
if [ -f "$CX_TARGET/config.toml" ]; then
  echo "[backup] $CX_TARGET/config.toml -> $CX_TARGET/config.toml.backup.$TIMESTAMP"
  cp "$CX_TARGET/config.toml" "$CX_TARGET/config.toml.backup.$TIMESTAMP"
fi
cp "$GENERATED_DIR/codex/config.toml" "$CX_TARGET/config.toml"
echo "[done] config.toml"

# Copy agents, skills, AGENTS.md (replace)
for item in agents skills AGENTS.md; do
  src="$GENERATED_DIR/codex/$item"
  if [ -e "$src" ]; then
    rm -rf "$CX_TARGET/$item"
    cp -r "$src" "$CX_TARGET/$item"
    echo "[done] $item"
  fi
done

# --- Cursor ---
echo ""
echo "━━━ Installing Cursor ━━━"
CR_TARGET="$HOME/.cursor"
mkdir -p "$CR_TARGET"
if [ -f "$CR_TARGET/mcp.json" ]; then
  if command -v jq >/dev/null 2>&1; then
    jq -s '{ mcpServers: (.[0].mcpServers // {} ) * (.[1].mcpServers // {}) }' \
      "$CR_TARGET/mcp.json" "$GENERATED_DIR/cursor/mcp.json" > "$CR_TARGET/mcp.json.tmp"
    mv "$CR_TARGET/mcp.json.tmp" "$CR_TARGET/mcp.json"
    echo "[done] mcp.json (merged)"
  else
    cp "$GENERATED_DIR/cursor/mcp.json" "$CR_TARGET/mcp.json"
    echo "[done] mcp.json (copied)"
  fi
else
  cp "$GENERATED_DIR/cursor/mcp.json" "$CR_TARGET/mcp.json"
  echo "[done] mcp.json (copied)"
fi

# Copy skills, AGENTS.md (replace)
for item in skills AGENTS.md; do
  src="$GENERATED_DIR/cursor/$item"
  if [ -e "$src" ]; then
    rm -rf "$CR_TARGET/$item"
    cp -r "$src" "$CR_TARGET/$item"
    echo "[done] $item"
  fi
done

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
