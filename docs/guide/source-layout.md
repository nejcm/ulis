---
title: Source Layout
---

# Source Layout

The canonical source tree lives in `.ulis/` (or `~/.ulis/` in global mode).

```text
.ulis/
├── config.yaml
├── mcp.yaml
├── permissions.yaml
├── plugins.yaml
├── skills.yaml
├── agents/
├── skills/
├── commands/
├── rules/
└── raw/
```

## Core files

- `config.yaml`: source version and project name.
- `mcp.yaml`: MCP server definitions and optional target restrictions.
- `permissions.yaml`: per-platform access policies.
- `plugins.yaml`: Claude plugin installs.
- `skills.yaml`: external skill installs per platform.

## Content directories

- `agents/`: Markdown files with frontmatter and prompt body.
- `skills/`: one directory per skill with `SKILL.md` and optional assets.
- `commands/`: slash command content copied into generated output.
- `rules/`: Markdown rule files, including nested folders, compiled to native rule formats where supported.
- `raw/`: platform-specific fragments deep-merged into generated output (see [Raw overrides](#raw-overrides)).

For full file examples, see [Examples](./examples.md).

## Raw overrides

Files placed under `raw/` are deep-merged into the generated output after each platform generator runs.

```text
raw/
├── common/          # applied to every platform
│   └── AGENTS.md
└── opencode/        # platform-specific, applied after common
    └── opencode.json
```

**Merge rules:**

- **Raw wins** on scalar conflicts — a value in the raw file always overwrites the generated value.
- **Objects are merged recursively** — nested keys from both sides survive.
- **Arrays are concatenated and deduplicated** — entries from the raw file are appended; duplicate primitives are removed.
- **Non-config files** (Markdown, scripts, etc.) are copied as-is regardless of whether a file already exists in the output.

Supported merge formats: `.json`, `.toml`, `.yaml` / `.yml`.

**Example** — add a custom MCP server and override the default model without touching the generated MCP block:

```json
// raw/common/opencode.json
{
  "model": "anthropic/opus",
  "mcp": {
    "my-server": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "my-server"]
    }
  }
}
```

After build, `generated/opencode/opencode.json` will contain all generated MCP servers **plus** `my-server`, and `model` will be `anthropic/opus`.

If a merge fails (e.g. malformed TOML), ULIS logs a warning and copies the raw file as-is so the build always completes.

## Generated output

`ulis build` writes generated native configs into:

```text
<source>/generated/<platform>/
```

`ulis install` then deploys those files to local or home-level tool directories.
