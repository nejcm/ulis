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

If you keep shared defaults in `~/.ulis/presets/`, you can layer them into any build/install run:

```bash
ulis preset list
ulis build --preset team-default
ulis install --preset team-default,react --yes
```

Preset merge order is left-to-right, then your base source is applied last (base wins conflicts). In non-interactive mode (`--yes`), missing presets fail immediately instead of prompting.

## Next reads

- [Project vs Global Mode](/guide/project-vs-global)
- [Source Layout](/guide/source-layout)
- [Examples](/guide/examples)
- [CLI Reference](/CLI)
