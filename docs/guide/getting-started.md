---
title: Getting Started
---

# Getting Started

`ulis` compiles one canonical config tree into native configuration for Claude Code, Codex, Cursor, OpenCode, and ForgeCode.

## Install

```bash
npm i -g @nejcm/ulis
```

or

```bash
bun add -g @nejcm/ulis
```

Requires Node 20+.

## Project mode quick start

Use project mode when you want configuration that lives with a single repository.

```bash
cd my-project
ulis init
```

This creates `.ulis/` in the current repository with scaffolded files and folders.

After editing `.ulis/`:

```bash
ulis install --yes
```

This builds generated output and installs into local tool folders like `./.claude/`, `./.cursor/`, `./.codex/`, `./.opencode/`, and `./.forge/`.

## Optional: Use presets

ULIS can layer **presets** (extra agents, skills, rules, etc.) under your base `.ulis/` or `~/.ulis/` tree. Presets come from `~/.ulis/presets/<name>/` and from **bundled** examples shipped with the CLI; a user folder with the same name overrides the bundled preset.

```bash
ulis preset list
ulis build --preset react-web
ulis install --preset backend,react-web --yes
```

Merge order: presets left-to-right, then the base source (base wins on conflicts). With `--yes`, a missing preset name fails fast instead of prompting.

## Next reads

- [Project vs Global Mode](/guide/project-vs-global)
- [Source Layout](/guide/source-layout)
- [Presets](/guide/presets)
- [Examples](/guide/examples)
- [CLI Reference](/CLI)
