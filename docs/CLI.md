---
title: CLI Reference
---

# CLI Reference

`ulis <command> [options]`

Running `ulis` with no command prints help. All commands exit non-zero on error with a message on stderr.

---

## `ulis init`

Scaffold a new `.ulis/` source tree with empty folders, template YAML files, and schema-backed headers.

```bash
ulis init [-g | --global]
```

| Flag             | Effect                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- |
| `-g`, `--global` | Scaffold `~/.ulis/` instead of `./.ulis/`. No `.gitignore` is written in this mode. |

**Project mode:**

1. Creates `./.ulis/` with `config.yaml`, `mcp.yaml`, `permissions.yaml`, `plugins.yaml`, `skills.yaml`, and empty `agents/`, `skills/`, `commands/`, `raw/` subfolders.
2. Reads the project name from `./package.json` (falls back to the directory name).
3. Appends `/.ulis/generated/` to `.gitignore` (creating the file if missing).
4. Prints a hint suggesting you also gitignore `./.claude/`, `./.cursor/`, `./.codex/`, `./.opencode/`, and `./.forge/` if you don't want to commit generated configs.

Fails if `.ulis/` (or `~/.ulis/` in global mode) already exists.

---

## `ulis build`

Parse, validate, and generate configs into `<source>/generated/<platform>/` without installing anything.

```bash
ulis build [-g | --global] [--source <path>] [--target <platforms>] [--preset <names>]
```

| Flag                   | Effect                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g`, `--global`       | Read from `~/.ulis/` instead of `./.ulis/`.                                                                                                         |
| `--source <path>`      | Explicit source path. Takes precedence over `--global`.                                                                                             |
| `--target <platforms>` | Comma-separated subset of `claude,codex,cursor,opencode,forgecode`. Default: all.                                                                   |
| `--preset <names>`     | Apply preset(s) before the base source (comma-separated). Resolved from `~/.ulis/presets/<name>/` first, then bundled presets shipped with the CLI. |

Output is always written under `<source>/generated/<platform>/`. Existing contents there are cleared before each build.

---

## `ulis install`

Run `build` and then deploy the generated configs onto the target platform directories.

```bash
ulis install [-g | --global] [--source <path>] [--target <platforms>]
             [-y | --yes] [--no-rebuild] [--backup] [--preset <names>]
```

| Flag                   | Effect                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g`, `--global`       | Read `~/.ulis/` and write to `~/.claude/`, `~/.codex/`, `~/.cursor/`, `~/.config/opencode/` (Windows: `%USERPROFILE%\.config\opencode\`), and `~/.forge/`. |
| `--source <path>`      | Override source (still writes to CWD or home depending on `--global`).                                                                                     |
| `--target <platforms>` | Only build/install the listed platforms.                                                                                                                   |
| `-y`, `--yes`          | Skip the "about to overwrite" confirmation prompt.                                                                                                         |
| `--no-rebuild`         | Don't rebuild — install whatever is already under `<source>/generated/`.                                                                                   |
| `--backup`             | Copy each existing platform dir to `<dir>.backup.YYYYMMDD_HHMMSS` before writing.                                                                          |
| `--preset <names>`     | Same resolution as `ulis build --preset` (user-global directory, then bundled).                                                                            |

**Preset resolution:** Each name maps to a directory. ULIS checks `~/.ulis/presets/<name>/` first; if that folder is missing, it uses the matching bundled preset next to the CLI (`dist/presets/` when installed). A preset in your home tree with the same folder name **shadows** the bundled one. Multiple `--preset` values merge **left to right**, then the base source (from `--source`, `./.ulis/`, or `~/.ulis/`) is applied last — **the base wins on conflicts**. Interactive runs prompt to continue when a name is missing; with `--yes`, missing presets fail immediately.

**Install strategy per platform:**

| Platform  | Managed dirs (replaced)                       | Merged files                         |
| --------- | --------------------------------------------- | ------------------------------------ |
| Claude    | `agents/`, `commands/`, `rules/`, `hooks/`, … | `settings.json`, `.claude.json` keys |
| OpenCode  | target dir contents                           | _none_                               |
| Codex     | target dir contents                           | _none_                               |
| Cursor    | `agents/` (`.mdc` files)                      | `mcp.json`                           |
| ForgeCode | `.forge/agents`, `.forge/skills`, `AGENTS.md` | `.forge/.mcp.json`                   |

Deep-merge preserves user-owned keys in `settings.json`, `.claude.json`, `mcp.json`, and `.forge/.mcp.json`.

---

## `ulis tui`

Launch the interactive terminal dashboard. Use it to choose a source, select presets and platforms, validate without writing files, build generated outputs, or install with an explicit destination review.

```bash
ulis tui
```

The TUI supports project `.ulis/`, global `~/.ulis/`, and custom source paths. Install destinations are explicit: project-local configs or home-level configs. If a project or global source is missing, the TUI can initialize it before continuing. Installs require a review screen where `backup` and `rebuild` can be toggled before execution (both default to enabled).

Keyboard controls:

- `j` / `k` or arrow keys move selection.
- `Enter` confirms selections and runs actions.
- `x` or `Space` toggles checkbox-style options (destination, presets, platforms, install options).
- `Backspace` goes back to the previous screen.
- `q` or `Ctrl+C` exits from non-input screens.

---

## `ulis preset`

List presets from **both** `~/.ulis/presets/` and the bundled preset set. User presets are preferred when the same folder name exists in both places.

```bash
ulis preset [--list]
ulis preset list
```

`-l` / `--list` is accepted. The default action is `list`. Each line shows the directory name (what you pass to `--preset`), a `user` or `bundled` label, optional `name` / `description` from `preset.yaml`, and the display title when it differs from the folder name.

---

## Exit codes

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| 0    | Success.                                                                |
| 1    | Source missing, validation error, user declined prompt, or I/O failure. |

All errors print a single human-readable line on stderr before exiting.

---

## Examples

Scaffold a project and install for Claude + Cursor only:

```bash
ulis init
# edit .ulis/agents/*.md, .ulis/mcp.yaml, etc.
ulis install --target claude,cursor --yes
```

Rebuild global configs after editing `~/.ulis/`:

```bash
ulis install --global --yes --backup
```

Dry-run against a fixture without touching home:

```bash
ulis build --source ./example
```

Reinstall from an existing build without regenerating:

```bash
ulis install --no-rebuild --yes
```

Build with reusable presets:

```bash
ulis preset list
ulis build --preset team-default,typescript
ulis install --preset team-default --yes
```
