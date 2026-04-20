# .ai/global

Canonical AI tool definitions shared across all platforms — Claude Code, OpenCode, Codex, and Cursor. This directory is the single source of truth; the build system generates platform-specific configs from it.

## Directory Structure

```
.ai/global/
├── agents/          # Agent definitions (model, temperature, tools, platform mappings)
├── commands/        # OpenCode slash commands (executable workflows)
├── hooks/           # Event-driven automation scripts (pre/post tool use, stop)
├── raw/             # Platform-specific source fragments injected verbatim into generated configs
├── skills/          # Reusable skill definitions invocable during sessions
├── tools/           # Shared utility scripts used by the build system
├── build.config.json  # Per-repo overrides for build defaults
├── guardrails.md      # Operational guidelines (cost controls, rate limits, security policies)
├── mcp.json           # MCP server configurations
├── permissions.json   # Per-platform access control rules
└── plugins.json       # External skill and plugin registrations
```

## Root Configuration Files

### `build.config.json`

Deep-merged on top of build defaults (`src/config.ts`). Only specify leaves you want to override. Supports per-platform keys: `codex.trustedProjects`, `opencode.readAllowlist`.

### `mcp.json`

MCP server definitions. Each entry specifies `type` (`local` or `remote`), connection details, and optional `targets` to restrict a server to specific platforms.

| Server                | Type   | Purpose                                  |
| --------------------- | ------ | ---------------------------------------- |
| `context7`            | remote | Up-to-date library docs (Context7)       |
| `github`              | local  | GitHub API access via `gh` token         |
| `gh_grep`             | remote | Code search across public GitHub repos   |
| `memory`              | local  | Persistent key-value memory across turns |
| `sequential-thinking` | local  | Structured multi-step reasoning          |
| `linear`              | remote | Linear issue tracker (OpenCode only)     |

Environment variables required: `CONTEXT7_API_KEY`, `GITHUB_PAT`, `LINEAR_API_KEY`.

### `permissions.json`

Access control per platform. See [permissions.json schema](../../schema/permissions.json) for full specification.

| Platform   | Key settings                                                                 |
| ---------- | ---------------------------------------------------------------------------- |
| `claude`   | `allow` / `deny` / `ask` lists for Bash commands                             |
| `opencode` | Granular `read/edit/bash/skill` permission rules with glob-pattern overrides |
| `codex`    | `approvalMode` (`suggest`) and `sandbox` level                               |
| `cursor`   | `mcpAllowlist` and `terminalAllowlist`                                       |

### `plugins.json`

External skill and plugin registrations. Top-level `"*"` key applies to all platforms; platform keys (`claude`, etc.) apply only to that tool.

Current registrations:

- **Vercel Labs** — `find-skills`
- **Matt Pocock** — `write-a-prd`, `prd-to-plan`, `grill-me`, `design-an-interface`, `request-refactor-plan`
- **Claude plugins** — `everything-claude-code`, `frontend-design`, `ralph-loop`

### `guardrails.md`

Documented operational policies for agents. **Not machine-enforced** — agents read this file and self-enforce. Covers:

- Operational limits (max 100 tool calls, 150k context tokens, max 2 retries)
- Cost controls (daily $100, per-session $10)
- Rate limits per agent type
- Security policies (auto-trigger paths, blocked destructive operations)
- Deployment protections (production gating, canary rollout)
- Model selection strategy by task type
- Customization profiles (Solo, Team, Regulated Industry)

## Build & Deploy

```bash
bun run build           # Regenerate all platform configs from .ai/global/
bun run install:configs # Deploy generated configs to their platform locations
```

Generated output lands in `generated/` at the repo root, organized by platform.
