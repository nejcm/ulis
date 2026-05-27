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

1. Creates `./.ulis/` with `config.yaml`, `mcp.yaml`, `permissions.yaml`, `skills.yaml`, `extensions.yaml`, and empty `agents/`, `skills/`, `commands/`, `raw/` subfolders.
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

Parse and validation failures print compact multi-line diagnostics before the final `No files written.` summary:

```text
[agent:worker] References MCP server "db" which is not defined in mcp.yaml
  source: base
  file: agents/worker.md
  path: /absolute/path/.ulis/agents/worker.md
  field: mcpServers[]
  target: all
  fix: Add "db" to mcp.yaml or remove the reference
```

`source` is `base` or `preset:<name>`. `target` is a specific platform, `all` for cross-platform fields, or `none` for source-only config issues. TUI validate uses the same diagnostic shape.

---

## `ulis install`

Run `build` and then deploy the generated configs onto the target platform directories.

```bash
ulis install [-g | --global] [--source <path>] [--target <platforms>]
             [-y | --yes] [--no-rebuild] [--backup] [--preset <names>]
             [--runner <npx|bunx>] [--no-extensions]
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
| `--runner <name>`      | Package runner used for `extensions.yaml` entries. `npx` or `bunx`. Overrides `runner` in `config.yaml`. Default: auto-detect (`bunx` if present).         |
| `--no-extensions`      | Skip running entries from `extensions.yaml`. Useful in CI where network installs are not desired.                                                          |

**Preset resolution:** Each name maps to a directory. ULIS checks `~/.ulis/presets/<name>/` first; if that folder is missing, it uses the matching bundled preset next to the CLI (`dist/presets/` when installed). A preset in your home tree with the same folder name **shadows** the bundled one. Multiple `--preset` values merge **left to right**, then the base source (from `--source`, `./.ulis/`, or `~/.ulis/`) is applied last — **the base wins on conflicts**. Interactive runs prompt to continue when a name is missing; with `--yes`, missing presets fail immediately.

**Install strategy per platform:**

| Platform  | Managed entries                                                              | Preserved native config                                                       |
| --------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Claude    | generated `agents/` and `skills/` entries by name; `commands/`, `rules/`, …  | `settings.json` `hooks`, UI/plugin settings; `.claude.json` `mcpServers`      |
| OpenCode  | generated `agents/core`, `agents/specialized`, and `skills/` entries by name | `opencode.json` `mcp`                                                         |
| Codex     | generated `agents/` and `skills/` entries by name                            | `config.toml` `projects`, `hooks`, `mcp_servers`, `tui`, `notice`, `features` |
| Cursor    | generated `agents/` and `skills/` entries by name                            | `mcp.json` `mcpServers`                                                       |
| ForgeCode | generated `.forge/agents` and `.forge/skills` entries by name; `AGENTS.md`   | `.forge/.mcp.json` `mcpServers`, `.forge.toml`                                |

Install preserves unmanaged destination agents and skills unless generated output has the same native name. Generated output wins at the same config path, and raw fragments win through the generated output because raw is merged during build. Existing non-allowlisted native config values are removed. If `--backup` is set, backups are created before parsing preserved native config.

---

## `ulis tui`

Launch the interactive terminal dashboard. Use it to choose a source, select presets and platforms, validate without writing files, build generated outputs, install with an explicit destination review, or install selected presets by themselves.

```bash
ulis tui
```

The TUI supports project `.ulis/`, global `~/.ulis/`, and custom source paths. Install destinations are explicit: project-local configs or home-level configs. If a project or global source is missing, the TUI can initialize it before continuing. Installs require a review screen where `backup` and `rebuild` can be toggled before execution. The Presets screen also has **Install selected presets**, which installs only the selected presets without reading the current source.

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
ulis preset install <names...> [-g | --global] [--target <platforms>]
                    [-y | --yes] [--backup] [--runner <npx|bunx>]
                    [--no-extensions]
```

`-l` / `--list` is accepted. The default action is `list`. Each line shows the directory name (what you pass to `--preset`), a `user` or `bundled` label, optional `name` / `description` from `preset.yaml`, and the display title when it differs from the folder name.

`ulis preset install <names...>` installs selected presets **without** merging a project or global source. Names may be comma-separated (`a,b`) or repeated (`a b`) and are merged in the order given. Generated output is temporary and is removed after install.

| Flag                   | Effect                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `-g`, `--global`       | Install to home-level platform config directories instead of the current project.            |
| `--target <platforms>` | Only install the listed platforms.                                                           |
| `-y`, `--yes`          | Skip overwrite confirmation prompts and fail fast for missing presets.                       |
| `--backup`             | Copy existing platform dirs/configs before writing.                                          |
| `--runner <name>`      | Package runner for preset `extensions.yaml` entries. `npx` or `bunx`; default: auto-detect.  |
| `--no-extensions`      | Skip preset `extensions.yaml` entries. Preset `skills.yaml` entries still run when declared. |

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
