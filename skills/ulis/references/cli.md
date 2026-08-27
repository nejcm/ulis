# CLI reference

Use this when you need exact flags, destinations, or preset/remote behavior.

## Source resolution

`ulis build` and `ulis install`:

1. `--source <path>` if set (must exist)
2. `--global` → `~/.ulis/`
3. else `./.ulis/` in CWD (no parent walk)

`ulis install --source <path> --global` builds that path and still installs to **home** destinations.

## Project vs global destinations

| | Project (default) | `--global` |
| --- | --- | --- |
| Source | `./.ulis/` | `~/.ulis/` |
| Generated | `<source>/generated/<platform>/` | same, under that source |
| Claude | `./.claude/` | `~/.claude/` |
| Codex | `./.codex/` | `~/.codex/` |
| Cursor | `./.cursor/` | `~/.cursor/` |
| OpenCode | `./.opencode/` | `~/.config/opencode/` (Windows: `%USERPROFILE%\.config\opencode\`) |
| ForgeCode | `./.forge/` | `~/.forge/` |

`init` in project mode also appends `/.ulis/generated/` to `.gitignore`. Global init does not write a gitignore.

## Commands

### `ulis init`

Fails if the target tree already exists.

```bash
ulis init
ulis init -g
```

### `ulis build`

Parse, validate, write `<source>/generated/<platform>/`. Clears that generated tree first. Does not install.

```bash
ulis build
ulis build --global
ulis build --source ./example
ulis build --target claude,cursor
ulis build --preset react-web,backend
```

`--source` with a git URL is refused. Clone or use `install --source <url>`.

Validation errors print diagnostics then `No files written.` Exit 1.

### `ulis install`

Build (unless `--skip-rebuild`), then copy into destinations. Confirm overwrite unless `-y`.

```bash
ulis install --target claude,cursor --yes
ulis install --global --backup --yes
ulis install --skip-rebuild --yes
ulis install --source https://github.com/acme/ulis-config#main
```

| Flag | Effect |
| --- | --- |
| `-g`, `--global` | Home source and home destinations |
| `--source <path\|url>` | Override source. Git URL allowed here |
| `--target` | Subset of platforms |
| `-y`, `--yes` | Skip overwrite **and** remote trust gate |
| `--skip-rebuild` | Use existing `generated/`. Refused if provenance says remote |
| `--backup` | Timestamped copies of existing platform dirs |
| `--no-prune` | Keep stale managed agents/local skills; they become unmanaged |
| `--preset` | Layer presets, then base source |
| `--runner npx\|bunx` | Runner for `extensions.yaml` |
| `--skip-extensions` | Do not run `extensions.yaml` |
| `--skip-external-skills` | Do not run `skills.yaml` |

Ownership: `.ulis-manifest.json` in each selected platform root. First manifest-aware install adopts the current set and prunes nothing. Later installs prune `previous managed − current generated` for **selected** platforms only. External `skills.yaml` installs are not in the manifest.

Preserved when possible: Claude `settings.json` / `settings.local.json` / `.claude.json`, project `.mcp.json` servers, OpenCode `opencode.json` `mcp`, Codex `config.toml` (base-first overlay), Cursor `mcp.json` servers, ForgeCode `.forge/.mcp.json` and `.forge.toml`.

`.env`: install loads `<destBase>/.env` then `<source>/.env` into **its** process only, adding keys, never overwriting the existing environment. A **remote** source's `.env` is never read.

### `ulis preset`

```bash
ulis preset list
ulis preset install team-default,react-web --yes
ulis preset install https://github.com/acme/ulis-presets --global --yes
```

Preset-only install does not merge `./.ulis/` or `~/.ulis/`. Output is temporary and deleted after install.

Resolution per name: `~/.ulis/presets/<name>/` first, then bundled presets next to the CLI. Same folder name in home **shadows** bundled.

Merge for `build`/`install --preset`: presets left to right, then **base source wins**. For `permissions.yaml` list fields, the highest layer that **declares** the field replaces the whole list (including declaring it empty). `skills.yaml` / `extensions.yaml` merge by entry identity (`key` or `name`).

### `ulis tui`

Needs Bun. Under Node, the CLI re-launches `dist/tui.js` with a found `bun`. No Bun: exit 1.

Keys: `j`/`k` or arrows move, `Enter` confirms, `x` or Space toggles, Backspace goes back, `q` exits most screens, `Ctrl+C` always.

Preferences: `~/.ulis-tui.json` (TUI only).

## Remote sources

Accepted on `install --source`, `--preset`, and `preset install`. HTTPS or SSH git URLs. `#ref` is branch or tag, not a commit SHA. No cache; shallow clone, then delete.

Trust gate lists commands from `skills.yaml`/`extensions.yaml`, generated `command` fields, runnable raw/skill files, and approval settings. Decline installs nothing (exit 0). Piped `y` does **not** answer the gate; use a TTY or `-y`.

`--skip-rebuild` after a remote build is refused so you cannot skip the gate on a later run.

## Reverse of each install toggle

| On (or default) | Off |
| --- | --- |
| prune (default) | `--no-prune` |
| rebuild (default) | `--skip-rebuild` (blocked if generated from remote) |
| run `extensions.yaml` | `--skip-extensions` |
| run `skills.yaml` | `--skip-external-skills` |
| overwrite in place (default) | `--backup` |

## Exit codes

- 0: success, or user declined the trust gate (nothing installed)
- 1: missing source, validation, declined overwrite, trust gate with no TTY and no `-y`, I/O, or a skills/extensions command failed

`ulis` with no command prints help and exits 0. Unknown command: 1.
