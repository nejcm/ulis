---
name: ulis
description: Explains how to use the ulis CLI and TUI to scaffold, build, validate, and install multi-platform AI tool configs from one source tree. Use when a user asks how to work with ulis, which command to run, how project/global mode behaves, how presets merge, or how to navigate the TUI.
argumentHint: "[task-or-question]"
allowImplicitInvocation: true
tools:
  read: true
  bash: true
tags:
  - ulis
  - cli
  - tui
  - docs
platforms:
  codex:
    displayName: ULIS Guide
    shortDescription: Explain ulis CLI and TUI workflows
    brandColor: "#0f766e"
---

# ULIS Usage Guide

Help with `ulis` usage, not general coding.

## What to cover

- Pick the right source mode: `--source <path>` first, then `--global`, otherwise `./.ulis/` in the current directory only.
- Distinguish `init`, `build`, `install`, `preset`, and `tui`.
- Explain where generated output and installed files go for project mode vs global mode.
- Prefer exact commands over abstract advice.

## Workflow

1. Identify the user's goal:
   - start a new config tree
   - inspect or validate without installing
   - build generated files
   - install to platform directories
   - browse presets
   - use the TUI
2. Give the narrowest command that matches that goal.
3. State important side effects:
   - `build` writes only to `<source>/generated/<platform>/`
   - `install` rebuilds unless `--skip-rebuild` is used
   - project mode writes into the current project; global mode writes into the home directory
4. If the user is unsure which files to edit, point them to `.ulis/agents/`, `.ulis/skills/`, `mcp.yaml`, `skills.yaml`, `permissions.yaml`, and `raw/`.

## Guardrails

- Do not claim ulis walks up parent directories; it does not.
- Do not describe generated output as canonical source; `.ulis/` or `~/.ulis/` is the source of truth.
- Mention presets merge left to right, then the base source wins on conflicts.
- For non-destructive help, prefer `ulis build` or `ulis tui` before `ulis install`.

## References

See [references/cli-tui.md](references/cli-tui.md) for command patterns, TUI controls, and common answers.
