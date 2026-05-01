---
title: Project vs Global Mode
---

# Project vs Global Mode

`ulis` supports two operating modes depending on whether you want per-repo config or one machine-wide config.

## Project mode

- Source path: `./.ulis/` in the current directory
- Typical init command: `ulis init`
- Typical install target: `./.claude/`, `./.codex/`, `./.cursor/`, `./.opencode/`

Use project mode when each repository needs distinct agent or MCP behavior.

## Global mode

- Source path: `~/.ulis/`
- Init command: `ulis init --global`
- Install command: `ulis install --global`
- Install targets: `~/.claude/`, `~/.codex/`, `~/.cursor/`, `~/.config/opencode/` (Windows: `%USERPROFILE%\.config\opencode\`, main file `opencode.json`)

Use global mode when you want one shared baseline across all projects on your machine.

## Source resolution precedence

For `ulis build` and `ulis install`, source resolution is:

1. `--source <path>`
2. `--global` (`~/.ulis/`)
3. local default (`./.ulis/`)
