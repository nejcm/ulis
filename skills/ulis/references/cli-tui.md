# ULIS CLI and TUI Reference

Use this reference when the user needs concrete `ulis` commands or behavior details.

## Core commands

- `ulis init`
  - Creates `./.ulis/` in the current directory.
  - Adds `/.ulis/generated/` to `.gitignore`.
- `ulis init --global`
  - Creates `~/.ulis/`.
- `ulis build`
  - Reads the selected source and writes generated output to `<source>/generated/<platform>/`.
  - Does not install into platform config directories.
- `ulis install`
  - Runs `build` first, then deploys generated files into platform directories.
- `ulis install --skip-rebuild`
  - Reuses existing generated output.
- `ulis preset list`
  - Lists user and bundled presets.
- `ulis tui`
  - Opens the interactive dashboard for source selection, validation, build, and install.

## Source resolution

Resolve the source in this order:

1. `--source <path>`
2. `--global` -> `~/.ulis/`
3. `./.ulis/` in the current working directory

There is no walk-up search.

## Project vs global mode

- Project mode:
  - source: `./.ulis/`
  - generated: `./.ulis/generated/`
  - install targets: project-local tool directories such as `./.claude/`, `./.codex/`, `./.cursor/`, `./.opencode/`, and `./.forge/`
- Global mode:
  - source: `~/.ulis/`
  - generated: `~/.ulis/generated/`
  - install targets: `~/.claude/`, `~/.codex/`, `~/.cursor/`, `~/.config/opencode/`, and `~/.forge/`

## Common answers

- Start a new project config:
  - `ulis init`
- Start a machine-wide config:
  - `ulis init --global`
- Build only for Codex and Cursor:
  - `ulis build --target codex,cursor`
- Build from a custom source tree:
  - `ulis build --source path/to/.ulis`
- Install without prompts:
  - `ulis install --yes`
- Install global config with backups:
  - `ulis install --global --backup --yes`
- Reuse a previous build:
  - `ulis install --skip-rebuild --yes`
- Layer presets:
  - `ulis build --preset react-web,backend`

## Presets

- Presets are merged in CLI order, left to right.
- The base source is applied last and wins on conflicts.
- Resolution order per preset name:
  - `~/.ulis/presets/<name>/`
  - bundled preset shipped with ulis

## TUI guidance

- `j` / `k` or arrow keys move
- `Enter` confirms
- `x` or `Space` toggles checkboxes
- `Backspace` goes back
- `q` or `Ctrl+C` exits

Use the TUI when the user wants:

- source and preset selection without memorizing flags
- validation before writing files
- a review step before install

## File layout to point users at

- `config.yaml` for source metadata
- `mcp.yaml` for MCP servers
- `permissions.yaml` for per-platform permissions
- `skills.yaml` for external skill installs
- `agents/` for agent markdown files
- `skills/` for local skill directories
- `commands/` for slash-command style content
- `raw/` for platform-native overrides
