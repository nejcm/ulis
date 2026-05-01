---
title: Presets
---

# Presets

**Presets** are optional ULIS source trees layered **under** your base config (project `.ulis/` or global `~/.ulis/`). Use them for shared team defaults, stack-specific skills, or the curated bundles that ship with `@nejcm/ulis`.

For merge mechanics in the architecture doc, see [Specification §2.2](/SPEC#presets). For flags and `ulis preset`, see [CLI Reference](/CLI).

## What presets do

- Presets use the **same on-disk layout** as a normal source tree: `agents/`, `skills/`, `mcp.yaml`, `raw/`, and so on ([Source Layout](/guide/source-layout)).
- They are merged **before** the base source, in the order you pass them. **The base wins** when the same agent, skill, or config key conflicts.
- Multiple presets merge **left to right** (`--preset a,b,c` → `a`, then `b`, then `c`, then base).

## Where presets are resolved

1. **User-global:** `~/.ulis/presets/<name>/` — your own or org presets.
2. **Bundled:** directories shipped with the CLI (next to the installed package). If a folder exists in **both** places with the same `<name>`, the **user** tree is used.

The preset **identifier** is always the **directory name** `<name>`, not the optional `name` field inside `preset.yaml`.

Run this for the list on your machine (folder names, `user` vs `bundled`, descriptions):

```bash
ulis preset list
```

## Optional `preset.yaml`

At the root of each preset folder you can add `preset.yaml` for display metadata only (listings and the TUI). It does **not** change the CLI name. Field reference: [Preset metadata](/REFERENCE#preset-metadata).

```yaml
# preset.yaml
name: Team default
description: Shared agents and rules for our org
version: 1
```

## Example layout

```text
~/.ulis/presets/team-default/
├── preset.yaml
├── skills.yaml
└── rules/
    └── style.md
```

## CLI usage

Apply one or more presets (comma-separated) when building or installing:

```bash
ulis build --preset react-web,backend
ulis install --preset team-default --yes
```

- **Interactive** `install` without `--yes`: if a name is missing, you may be prompted to continue without it.
- **`--yes`**: missing preset names **fail immediately** (no prompt).

`ulis preset` / `ulis preset list` / `ulis preset -l` lists user and bundled presets.

## TUI

In `ulis tui`, open **Presets** to toggle which bundles apply to **validate**, **build**, and **install**. The same merge rules apply as on the CLI.

## Further reading

- [Getting Started — optional presets](/guide/getting-started#optional-use-presets)
- [Examples](/guide/examples#presets) (short pointer and cross-links)
- [Field Reference — `preset.yaml`](/REFERENCE#preset-metadata)
