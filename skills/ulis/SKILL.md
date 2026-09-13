---
name: ulis
description: >-
  Use the ulis CLI and author a .ulis/ source tree that generates Claude Code,
  Codex, Cursor, OpenCode, and ForgeCode configs. Use whenever the user mentions
  ulis, @nejcm/ulis or .ulis/. Do not invent platform dialects; edit the ULIS 
  source and run the CLI.
allowImplicitInvocation: true
tools:
  read: true
  bash: true
tags:
  - ulis
  - cli
  - source
---

# ULIS

`ulis` (`@nejcm/ulis`) reads one source tree and writes native configs for Claude Code, Codex, Cursor, OpenCode, and ForgeCode.

Docs: https://nejcm.github.io/ulis/ · field reference is generated from Zod, not from this skill.

This skill is for using the CLI and editing a source tree. It is not for changing the ulis compiler itself.

## Decide the job

| User wants | Do this |
| --- | --- |
| New tree | `ulis init` or `ulis init --global` |
| Edit agents, skills, MCP, permissions, raw files | Edit the **source**, then `ulis build` to check |
| See generated files without touching tools | `ulis build` |
| Deploy into Claude/Cursor/Codex/… dirs | `ulis install` (read [Install safety](#install-safety) first) |
| Shared layer on top of their tree | `--preset <names>` or `ulis preset install` |
| Guided UI | `ulis tui` (needs Bun) |

Give the narrowest command. Prefer `build` until they ask to install.

## Source vs destination

**Source** is what you edit: `./.ulis/` (project), `~/.ulis/` (global), `--source <path>`, or a git URL on install only.

**Destination** is where install writes native files: project dirs under CWD, or home dirs with `--global`.

Generated files under `<source>/generated/<platform>/` are build output. Do not treat them as the source of truth. Do not hand-edit destination files to "fix" ULIS; change the source and rebuild.

Resolution order for `build` and `install`:

1. `--source <path>`
2. `--global` → `~/.ulis/`
3. `./.ulis/` in the current directory only

There is no walk-up. Missing source: hint `ulis init` or `ulis init --global`.

`--source` on `build` must be a local path. A git URL is refused because build would write into a clone that is thrown away. Use `ulis install --source <git-url>` or clone first.

## Install safety

`ulis install` writes real tool dirs. With `--global` that is `$HOME`: `~/.claude/`, `~/.codex/`, `~/.cursor/`, `~/.config/opencode/`, `~/.forge/`.

Two defaults that surprise people:

- **Prune is on.** Install deletes destination agents and local skills that are in the ownership manifest but not in the current generated set. `--no-prune` keeps them and they become unmanaged.
- **Backup is off.** `--backup` copies aside first (`*.backup.YYYYMMDD_HHMMSS`).

Other rules:

- `-y` / `--yes` skips the overwrite prompt **and** the remote-source trust gate. Do not pass `-y` on a git URL the user has not reviewed.
- `--skip-rebuild` installs whatever is already in `generated/`. It is refused (even with `-y`) if that output was built from a remote source. Re-run with `--preset <url>` or `--source <url>` so the clone can be previewed again.
- Unmanaged destination entries and allowlisted native config (MCP maps, hooks, Codex trusted projects, `.forge.toml`, and similar) survive unless generated output overwrites the same path.
- There is no `ulis uninstall`. Removal is prune against a shrinking generated set, or the user deleting files by hand.

Install phases: **build → files → skills.yaml → extensions.yaml**. Skip network phases with `--skip-external-skills` and `--skip-extensions`.

Before `ulis install` for someone else, state the source, destination (project vs home), whether prune will delete named entries, and whether `--backup` is on.

## Author a source

Scaffold, then fill files. Read [references/source.md](references/source.md) before inventing filenames or YAML keys.

```text
.ulis/
├── config.yaml
├── mcp.yaml
├── permissions.yaml
├── skills.yaml
├── extensions.yaml
├── agents/           # {name}.md
├── skills/           # {name}/SKILL.md
├── commands/
├── rules/
└── raw/all/          # every platform
    └── <platform>/   # one of claude, codex, cursor, opencode, forgecode
```

Local skills live under `skills/<name>/`. External installs (`npx skills add …`) live in `skills.yaml`. Those are different.

`raw/all/` is injected into every platform. `raw/<platform>/` is that target only. Raw values win at the same path. `raw/common/` is not a directory ULIS reads.

After edits, `ulis build` (optionally `--target claude,cursor`). Check diagnostics. Install only when they want destinations updated.

## Commands at a glance

```bash
npm i -g @nejcm/ulis   # or: bun add -g @nejcm/ulis
# Node 20.3+. TUI also needs Bun.

ulis init
ulis init --global

ulis build [--source <path>] [--global] [--target <platforms>] [--preset <names>]
ulis install [--source <path>] [--global] [--target <platforms>] [--preset <names>]
             [--yes] [--backup] [--no-prune] [--skip-rebuild]
             [--skip-extensions] [--skip-external-skills] [--runner npx|bunx]

ulis preset list
ulis preset install <names...> [--global] [--yes] [--backup] [--no-prune]

ulis tui
```

Platforms: `claude`, `codex`, `cursor`, `opencode`, `forgecode`. `--target` must name at least one.

Flags, presets, remote URLs, TUI keys, and project vs home paths: [references/cli.md](references/cli.md).

## How to answer

1. Name the source you will use.
2. If they need a file change, edit source files, not generated or destination trees.
3. Quote a command they can paste. Include `--global` only when they asked for home-level config.
4. If the next step is install, mention prune and backup in one sentence.
5. If validation fails, read the diagnostic (`file`, `field`, `fix`) instead of guessing.
