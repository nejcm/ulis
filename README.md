# ai-configs

Single source of truth for AI tool configurations across [OpenCode](https://opencode.ai), [Claude Code](https://claude.ai/code), [Codex](https://github.com/openai/codex), and [Cursor](https://cursor.com).

A TypeScript build system reads canonical sources from `.ai/` and generates tool-specific configs into `generated/` at the repo root, which are then deployed by an install script.

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

# 2. Build all tool configs
bun run build

# 3. Deploy to your home directory
bun run install:configs
```

**Required environment variables** — set in your shell profile or copy `.env.example` to `.env`:

```
GITHUB_PAT          GitHub Personal Access Token
CONTEXT7_API_KEY    Context7 API Key
LINEAR_API_KEY      Linear API Key
```

## Repository Structure

```
.ai/
  agents/           # 13 canonical agent definitions → see agents/README.md
  skills/           # 16 skill definitions           → see skills/README.md
  commands/         # 7 slash commands               → see commands/README.md
  workflows/        # Workflow checklists            → see workflows/README.md
  scripts/          # Runtime utility scripts        → see scripts/README.md
  plugins/          # TypeScript plugins             → see plugins/README.md
  docs/             # Integration documentation      → see docs/README.md
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

The TypeScript sources under `src/` read canonical definitions from `.ai/` and write per-tool trees under `generated/`. Dependencies (`tsx`, `typescript`, `zod`, `gray-matter`, `oxfmt`, …) are declared in the root `package.json`.

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

| Source                                           | OpenCode                                     | Claude Code                                      | Codex                   | Cursor     |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------ | ----------------------- | ---------- |
| `agents/*.md`                                    | `opencode.json` agent blocks + `agents/` dir | `rules/common/agents.md` (generated)             | Instruction sections    | —          |
| `guardrails.md`, `workflows/`                    | —                                            | `rules/common/guardrails.md`, `rules/workflows/` | Appended to `AGENTS.md` | —          |
| `mcp.json`                                       | `opencode.json` mcp block                    | `settings.json` mcpServers                       | `config.toml`           | `mcp.json` |
| `plugins.json`                                   | Plugin array                                 | `settings.json` enabledPlugins                   | —                       | —          |
| `skills/`, `commands/`, `workflows/`, `scripts/` | Copied as-is                                 | —                                                | —                       | —          |

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
| `typescript`  | Type checking via `bun run typecheck`            |
| `zod`         | Schema validation for all config types           |
| `gray-matter` | Parse YAML frontmatter from agent Markdown files |
| `oxfmt`       | Formatting (`fmt` / `fmt:check`)                 |
| `@types/node` | Node.js type definitions                         |

## Bun scripts

```bash
bun run build              # Build all 4 tool configs
bun run build:opencode     # Build OpenCode only
bun run build:claude       # Build Claude Code only
bun run build:codex        # Build Codex only
bun run build:cursor       # Build Cursor only
bun run typecheck          # Type-check the build system
bun run clean              # Delete generated/
bun run install:deps       # Install build dependencies
bun run install:configs    # Deploy to home directory
bun run rebuild            # Force rebuild
bun run fmt                # Format with [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)
bun run fmt:check          # Check formatting (CI-friendly)
```

## Install Behavior

| Tool                 | Strategy         | Target                    |
| -------------------- | ---------------- | ------------------------- |
| OpenCode             | Overwrite        | `~/.opencode/`            |
| Claude Code settings | Merge (additive) | `~/.claude/settings.json` |
| Codex                | Overwrite        | `~/.codex/config.toml`    |
| Cursor               | Merge (additive) | `~/.cursor/mcp.json`      |

Existing configs are backed up before any overwrite (`*.backup.YYYYMMDD_HHMMSS`).

## Security

- No secrets committed — all API keys use `${ENV_VAR}` references
- Build validates this via Zod schemas
- `scripts/health-check.sh` scans for accidental key leakage
