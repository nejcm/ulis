# ⚠️ WORK IN PROGRESS

# ai-configs

> 💡 **ULIS**: Unified LLM Interface Specification

Single source of truth for AI tool configurations across [OpenCode](https://opencode.ai), [Claude Code](https://claude.ai/code), [Codex](https://github.com/openai/codex), and [Cursor](https://cursor.com).

A TypeScript build system reads canonical sources from `.ai/global/` and generates tool-specific configs into `generated/` at the repo root, which are then deployed by an install script.

## Specification

- **[docs/SPEC.md](./docs/SPEC.md)** — Architecture, entity model, capability matrix, versioning, and extension guide.
- **[docs/REFERENCE.md](./docs/REFERENCE.md)** — Auto-generated field reference for every schema type (regenerate with `bun run gen:reference`).
- **[schemas/](./schemas/)** — JSON Schema files for all entity types (regenerate with `bun run gen:schemas`).

## Why

Each tool uses a different config format, different MCP server syntax, different agent/rule structures, and different env var interpolation. Without a single source, configs diverge and secrets (like API keys) end up hardcoded in tool-specific files.

## Prerequisites

- [Bun](https://bun.sh) 1.x — installs dependencies and runs the build (`bun run …` from the repo root)

## Quick Start

```bash
# 1. Install build dependencies (once)
bun run install:deps

# 2. Launch the interactive TUI
bun run tui

# 3. Or use the non-interactive flow
bun run build
bun run install:configs
```

## Interactive TUI

Run `bun run tui` to open a full-screen terminal UI powered by `cel-tui`.

- Starts with a welcome screen and keyboard help
- Lets you choose generation targets independently from install targets
- Shows an optional backup toggle before execution
- Streams live build/install progress in the same interface

**Required environment variables** — set in your shell profile or copy `.env.example` to `.env`:

```
GITHUB_PAT          GitHub Personal Access Token
CONTEXT7_API_KEY    Context7 API Key
LINEAR_API_KEY      Linear API Key
```

## MCP Configuration

MCP servers are defined once in `.ai/global/mcp.json` and distributed per-platform using the `targets` field:

| `targets` value          | Meaning                                                        |
| ------------------------ | -------------------------------------------------------------- |
| _omitted_                | Applies to **all** platforms (claude, opencode, codex, cursor) |
| `["opencode", "claude"]` | Applies only to the listed platforms                           |
| `[]` (empty array)       | **Disabled** — server is excluded from every platform          |

Example — `github` applies everywhere, `linear` applies only to OpenCode:

```json
{
  "servers": {
    "github": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PAT}" }
    },
    "linear": {
      "type": "remote",
      "url": "https://mcp.linear.app/mcp",
      "headers": { "Authorization": "Bearer ${LINEAR_API_KEY}" },
      "targets": ["opencode"]
    }
  }
}
```

Generators iterate servers via the shared `mcpServersFor(mcp, target)` helper in `src/utils/mcp-block.ts`, which centralizes the filter so every generator applies identical semantics.

### Adding an MCP server

1. Add an entry under `servers` in `.ai/global/mcp.json`.
2. Omit `targets` if it should apply everywhere, or list specific platforms.
3. Reference any secrets as `${ENV_VAR}` — never hardcode.
4. For remote servers that Codex needs to access, provide a `localFallback` (Codex only supports local command-based MCPs).
5. Run `bun run build` to regenerate all tool configs.

## Skills

Skills are reusable, invocable capabilities (each a `SKILL.md` file) stored in `.ai/global/skills/`. The build system copies them as-is into `generated/opencode/skills/`.

### Installing skills from a registry

The [Vercel Skills CLI](https://github.com/vercel-labs/skills) (`npx skills@latest`) installs only into known agent directories and has no `--dir` flag. Use the wrapper script instead:

```bash
# Install all skills from a package
bun run install:skill vercel-labs/agent-skills --yes

# Install a specific skill
bun run install:skill vercel-labs/agent-skills --skill deploy-to-vercel --yes

# Install from a GitHub URL
bun run install:skill https://github.com/org/skills-repo --yes
```

The script installs via the `universal` agent into a temporary `.agents/` directory, moves the result to `.ai/global/skills/`, then removes the staging directory.

After installing, run `bun run build` to include the new skill in generated configs.

### Adding a skill manually

1. Create `.ai/global/skills/<name>/SKILL.md` with the skill instructions.
2. Optionally add a `config/` or `references/` subdirectory.
3. Run `bun run build` — the skill is included automatically.

## Repository Structure

```
.ai/
  global/           # Canonical sources (agents, skills, MCP, …)
    agents/           # canonical agent definitions → see agents/README.md
    skills/           # skill definitions           → see skills/README.md
    commands/         # slash commands              → see commands/README.md
    mcp.json          # Canonical MCP server definitions
    plugins.json      # Claude Code marketplace plugins/skills
    guardrails.md     # Cost controls and rate limits
src/                # TypeScript build system (see below)
generated/          # Built output — committed, ready to install without building
install.sh          # Linux/macOS installer
install.ps1         # Windows installer
install.js          # Cross-platform entry (loads .env, runs install.sh / install.ps1)
```

## Build system

The TypeScript sources under `src/` read canonical definitions from `.ai/global/` and write per-tool trees under `generated/`. Dependencies (`tsx`, `typescript`, `zod`, `gray-matter`, `oxfmt`, …) are declared in the root `package.json`.

```
src/
  index.ts            # CLI entry — parse → validate → generate
  schema.ts           # Zod schemas for all config types
  config.ts           # Model name maps, build constants
  parsers/
    agent.ts            # Parse agents/*.md (gray-matter + body)
    mcp.ts              # Parse mcp.json
    plugins.ts          # Parse plugins.json
  generators/
    opencode.ts         # → generated/opencode/
    claude.ts           # → generated/claude/
    codex.ts            # → generated/codex/
    cursor.ts           # → generated/cursor/
  utils/
    env-var.ts          # Translate ${VAR} to tool-specific syntax
    fs.ts               # File I/O helpers
    logger.ts           # Colored build output
```

### Generator outputs

| Source                 | OpenCode                                     | Claude Code                          | Codex                   | Cursor     |
| ---------------------- | -------------------------------------------- | ------------------------------------ | ----------------------- | ---------- |
| `agents/*.md`          | `opencode.json` agent blocks + `agents/` dir | `rules/common/agents.md` (generated) | Instruction sections    | —          |
| `guardrails.md`        | —                                            | `rules/common/guardrails.md`         | Appended to `AGENTS.md` | —          |
| `mcp.json`             | `opencode.json` mcp block                    | `settings.json` mcpServers           | `config.toml`           | `mcp.json` |
| `plugins.json`         | Plugin array                                 | `settings.json` enabledPlugins       | —                       | —          |
| `skills/`, `commands/` | Copied as-is                                 | —                                    | —                       | —          |

### Adding a new generator

1. Create `src/generators/<tool>.ts` implementing the generator.
2. Import and call it from `src/index.ts`.
3. Add a matching script in `package.json` if you want a `build:<tool>` shortcut.

### Validation

Schemas in `schema.ts` validate canonical sources at build time with Zod. The build fails if frontmatter is invalid, MCP targets are unknown, or env vars are hardcoded instead of `${VAR}` syntax.

### Dependency roles

| Package       | Purpose                                          |
| ------------- | ------------------------------------------------ |
| `tsx`         | Run TypeScript directly (no compile step)        |
| `typescript`  | Type checking via `bun run lint`                 |
| `zod`         | Schema validation for all config types           |
| `gray-matter` | Parse YAML frontmatter from agent Markdown files |
| `oxfmt`       | Formatting (`format` / `format:check`)           |
| `@types/node` | Node.js type definitions                         |

## Bun scripts

```bash
bun run build              # Build all 4 tool configs
bun run build:opencode     # Build OpenCode only
bun run build:claude       # Build Claude Code only
bun run build:codex        # Build Codex only
bun run build:cursor       # Build Cursor only
bun run lint               # Type-check the build system
bun run clean              # Delete generated/
bun run install:deps       # Install build dependencies
bun run install:configs    # Deploy to home directory
bun run install:skill      # Install a skill from npx skills@latest into .ai/global/skills/
bun run rebuild            # Force rebuild
bun run format             # Format with [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)
bun run format:check       # Check formatting (CI-friendly)
bun run tui                # Launch the interactive generator/install UI
```

## Install Behavior

| Tool                 | Strategy         | Target                    |
| -------------------- | ---------------- | ------------------------- |
| OpenCode             | Overwrite        | `~/.opencode/`            |
| Claude Code settings | Merge (additive) | `~/.claude/settings.json` |
| Codex                | Overwrite        | `~/.codex/config.toml`    |
| Cursor               | Merge (additive) | `~/.cursor/mcp.json`      |

When `--backup` is enabled, existing configs are backed up before overwrite (`*.backup.YYYYMMDD_HHMMSS`).

## Security

- No secrets committed — all API keys use `${ENV_VAR}` references
- Build validates this via Zod schemas
