# CLI reference

`ulis <command> [options]`

Running `ulis` with no command prints help. All commands exit non-zero on error with a message on stderr.

---

## `ulis init`

Scaffold a new `.ulis/` source tree with empty folders, template YAML files, and schema-backed headers.

```
ulis init [-g | --global]
```

| Flag             | Effect                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- |
| `-g`, `--global` | Scaffold `~/.ulis/` instead of `./.ulis/`. No `.gitignore` is written in this mode. |

**Project mode:**

1. Creates `./.ulis/` with `config.yaml`, `mcp.yaml`, `permissions.yaml`, `plugins.yaml`, `guardrails.md`, and empty `agents/`, `skills/`, `commands/`, `raw/` subfolders.
2. Reads the project name from `./package.json` (falls back to the directory name).
3. Appends `/.ulis/generated/` to `.gitignore` (creating the file if missing).
4. Prints a hint suggesting you also gitignore `./.claude/`, `./.cursor/`, `./.codex/`, `./.opencode/` if you don't want to commit generated configs.

Fails if `.ulis/` (or `~/.ulis/` in global mode) already exists.

---

## `ulis build`

Parse, validate, and generate configs into `<source>/generated/<platform>/` without installing anything.

```
ulis build [-g | --global] [--source <path>] [--target <platforms>]
```

| Flag                   | Effect                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| `-g`, `--global`       | Read from `~/.ulis/` instead of `./.ulis/`.                             |
| `--source <path>`      | Explicit source path. Takes precedence over `--global`.                 |
| `--target <platforms>` | Comma-separated subset of `claude,codex,cursor,opencode`. Default: all. |

Output is always written under `<source>/generated/<platform>/`. Existing contents there are cleared before each build.

---

## `ulis install`

Run `build` and then deploy the generated configs onto the target platform directories.

```
ulis install [-g | --global] [--source <path>] [--target <platforms>]
             [-y | --yes] [--no-rebuild] [--backup]
```

| Flag                   | Effect                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `-g`, `--global`       | Read `~/.ulis/` and write to `~/.claude/`, `~/.codex/`, `~/.cursor/`, `~/.opencode/`. |
| `--source <path>`      | Override source (still writes to CWD or home depending on `--global`).                |
| `--target <platforms>` | Only build/install the listed platforms.                                              |
| `-y`, `--yes`          | Skip the "about to overwrite" confirmation prompt.                                    |
| `--no-rebuild`         | Don't rebuild — install whatever is already under `<source>/generated/`.              |
| `--backup`             | Copy each existing platform dir to `<dir>.backup.YYYYMMDD_HHMMSS` before writing.     |

**Install strategy per platform:**

| Platform | Managed dirs (replaced)                       | Merged files                         |
| -------- | --------------------------------------------- | ------------------------------------ |
| Claude   | `agents/`, `commands/`, `rules/`, `hooks/`, … | `settings.json`, `.claude.json` keys |
| OpenCode | `agents/`, `skills/`, `commands/`             | `opencode.json`                      |
| Codex    | `agents/`, `AGENTS.md`                        | `config.toml` (sectional)            |
| Cursor   | `agents/` (`.mdc` files)                      | `mcp.json`                           |

Deep-merge preserves user-owned keys in `settings.json` / `mcp.json` / `opencode.json` that `ulis` doesn't touch.

---

## `ulis tui`

Launch the interactive terminal UI. Useful when you want to pick generation and install targets separately, toggle backups, and stream progress in the same screen.

```
ulis tui
```

The TUI reads from `~/.ulis/` and writes to the corresponding home directories. It's the equivalent of `ulis install --global` with a point-and-click selection.

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
ulis build --source ./tests/fixtures/example-ulis
```

Reinstall from an existing build without regenerating:

```bash
ulis install --no-rebuild --yes
```
