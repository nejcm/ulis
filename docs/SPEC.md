# ULIS — Unified LLM Interface Specification

Version `1.0.0` · Source: `src/schema/` · Targets: Claude Code, OpenCode, Codex, Cursor · CLI: `@nejcm/ulis`

---

## 1. Overview

ULIS is a CLI (`ulis`) that lets you define AI agent configurations **once** and compile them into the native format expected by each supported tool. You write canonical entity definitions in `.ulis/` (project) or `~/.ulis/` (global), run `ulis build` (or `ulis install` to also deploy), and get ready-to-deploy configs under `<source>/generated/`.

```
.ulis/                        .ulis/generated/
├── agents/*.md       ─────►  ├── claude/   (agents/, commands/, settings.json, rules/)
├── skills/*/         ─────►  ├── opencode/ (opencode.json, agents/, skills/)
│   SKILL.md                  ├── codex/    (config.toml, agents/*.toml, AGENTS.md)
├── mcp.yaml          ─────►  └── cursor/   (agents/*.mdc, skills/, mcp.json)
├── plugins.yaml
├── permissions.yaml
├── guardrails.md
└── config.yaml          ◄─── minimal: version + name (room to grow)
```

The generated tree is then copied to the per-platform destination (`./.claude/` or `~/.claude/` depending on mode) by `ulis install`.

**Why it exists:** Claude Code, OpenCode, Codex, and Cursor all have incompatible config formats. Without ULIS you maintain four separate, drift-prone config trees. ULIS keeps one source of truth and compiles it.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Source: .ulis/  (or ~/.ulis/)                          │
│  agents/*.md  skills/*/SKILL.md  mcp.yaml  plugins.yaml │
└────────────────────────┬────────────────────────────────┘
                         │ gray-matter + Zod parse
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Canonical bundle                                       │
│  ParsedAgent[]  ParsedSkill[]  McpConfig  PluginsConfig │
└──────────┬──────────┬──────────┬──────────┬────────────┘
           │          │          │          │
    generateClaude  generateOpencode  generateCodex  generateCursor
           │          │          │          │
           ▼          ▼          ▼          ▼
     generated/claude  opencode  codex    cursor
```

Each `generate*` function:

1. Reads the canonical bundle and the resolved `BuildConfig`
2. Maps canonical types (model aliases, tool groups, permission levels) to platform specifics
3. Emits native files (YAML frontmatter, JSON, TOML, MDC)

Between parsing and generation the orchestrator runs **validators** (`src/validators/`):

- `validateCrossRefs(agents, skills, mcp)` — agent → skill (warn), agent → mcp (**error**), agent → subagent allowlist (warn)
- `validateCollisions(agents, skills)` — duplicate agent or skill names (**error**)

Errors abort the build (exit code 1, no files written). Warnings print and the build proceeds.

## 2.1 Build configuration

`config.yaml` holds the minimum the CLI needs (`version`, `name`). All machine-specific defaults live in `src/config.ts` under `BUILD_CONFIG.platforms.<tool>`.

> **Legacy note:** earlier versions read a `build.config.json` file for deep-merged overrides. That file is no longer loaded automatically; the example block below is kept as a reference for the override surface that will re-land on `config.yaml` in a future release.

All machine-specific or platform-tunable constants live in `src/config.ts` under `BUILD_CONFIG.platforms.<tool>`. To override any leaf field for your repo, create `.ulis/build.config.json` with the same shape — it is **deep-merged** on top of the defaults at build time, so you only specify what you want to change.

Example:

```json
{
  "platforms": {
    "codex": {
      "trustedProjects": {
        "C:\\Work\\Personal\\my-repo": "trusted"
      }
    },
    "opencode": {
      "readAllowlist": {
        "C:/Work/some/path/*": "allow"
      }
    }
  }
}
```

Per-platform sections supported:

| Platform   | Override-friendly fields                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude`   | `modelMap`, `toolNames`                                                                                                                                       |
| `cursor`   | `modelMap`, `toolNames`                                                                                                                                       |
| `codex`    | `model`, `modelReasoningEffort`, `sandbox`, `trustedProjects`, `mcpStartupTimeoutSec`                                                                         |
| `opencode` | `defaultModel`, `smallModel`, `modelMap`, `agentNameMap`, `bashAllowlist`, `skillAllowlist`, `toolPermissions`, `readAllowlist`, `externalDirectoryAllowlist` |

The file is optional. Without it, code defaults from `src/config.ts` are used unchanged.

Capability mismatches are handled with **best-effort + comments**: if a target lacks native support for a field, the value is emitted as a comment in the generated file so reviewers can see it, and the build continues (no hard failure).

---

## 3. Entity Model

### 3.1 Agent

An autonomous task executor. Defined in `.ulis/agents/{name}.md` with YAML frontmatter + a Markdown prompt body.

```yaml
# .ulis/agents/builder.md
---
description: Implements features from specs
model: sonnet
tools:
  read: true
  write: true
  edit: true
  bash: true
contextHints:
  maxInputTokens: 80000
  priority: high
toolPolicy:
  requireConfirmation:
    - Write
security:
  blockedCommands:
    - git push --force
  rateLimit:
    perHour: 20
platforms:
  claude:
    permissionMode: default
  opencode:
    mode: subagent
---
You are a focused implementation agent. Read specs carefully before writing code.
```

**Key fields:**

| Field          | Purpose                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model`        | Canonical alias: `opus`, `sonnet`, `haiku`, `inherit`. Mapped per-platform.                                                                                        |
| `tools`        | Permission groups: `read`, `write`, `edit`, `bash`, `search`, `browser`, `agent`.                                                                                  |
| `contextHints` | Advisory window hints. Emitted as comments (no native equivalent on any current target).                                                                           |
| `toolPolicy`   | `prefer`/`avoid` → comments. `requireConfirmation` → native permission controls where supported.                                                                   |
| `security`     | `permissionLevel: readonly` → Claude `plan` mode + OpenCode deny perms. `blockedCommands` → Claude PreToolUse hooks. `rateLimit` → OpenCode `rate_limit_per_hour`. |
| `platforms`    | Per-target overrides. Applied last; they win over derived values from canonical fields.                                                                            |

### 3.2 Skill

A composable, invocable capability. Defined as a directory `.ulis/skills/{name}/SKILL.md`. Both the prompt and associated files (scripts, templates) live in the same directory.

```yaml
# .ulis/skills/code-quality/SKILL.md
---
description: Run code quality checks on the current file
argumentHint: "[file-path]"
tools:
  read: true
  bash: true
isolation: fork
---
Run the following checks...
```

Skills become:

- **Claude**: slash commands in `generated/claude/commands/`
- **OpenCode**: skill directories in `generated/opencode/skills/`
- **Codex**: skill directories in `generated/codex/skills/`
- **Cursor**: skill directories in `generated/cursor/skills/`

### 3.3 MCP Server

Defined once in `.ulis/mcp.yaml` (JSON is also accepted for backwards compatibility). Each server may declare a `targets` list to restrict it to specific platforms.

**Semantics:**

- **Omitted `targets`** — server applies to every platform (the default).
- **Populated array** (e.g. `["opencode"]`) — server applies only to the listed platforms.
- **Empty array** `[]` — server is disabled (applies to no platforms).

```json
{
  "servers": {
    "github": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    },
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "localFallback": {
        "command": "npx",
        "args": ["-y", "@context7/mcp-server"]
      }
    },
    "linear": {
      "type": "remote",
      "url": "https://mcp.linear.app/mcp",
      "targets": ["opencode"]
    }
  }
}
```

`localFallback` is used for Codex, which only supports local command-based MCP servers.

Environment variables use `${VAR}` syntax everywhere. The build translates to platform-specific syntax (OpenCode headers use `{env:VAR}`).

### 3.4 Plugin / Skill registry entry

Defined in `.ulis/plugins.yaml` (JSON also accepted). The file is keyed by platform name or the special `"*"` wildcard:

```json
{
  "*": {
    "skills": [
      { "name": "mattpocock/skills/grill-me" },
      { "name": "vercel-labs/agent-skills", "args": ["--skill", "find-skills"] }
    ]
  },
  "claude": {
    "plugins": [
      {
        "name": "everything-claude-code",
        "source": "github",
        "repo": "affaan-m/everything-claude-code"
      },
      { "name": "frontend-design", "source": "official" }
    ],
    "skills": []
  },
  "opencode": {
    "skills": [{ "name": "some-opencode-skill" }]
  }
}
```

**Key semantics:**

| Key            | Effect during `install:configs`                                                          |
| -------------- | ---------------------------------------------------------------------------------------- |
| `"*"`          | `skills` are installed for **all** platforms via `npx skills@latest add -a <each-agent>` |
| `"<platform>"` | `skills` are installed for that platform only (`-a <agent-name>`)                        |
| `"claude"`     | `plugins` are installed via `claude plugin add --from <source>`                          |

Skills are installed **system-globally** — `npx skills@latest add` writes directly into each agent's known config directory. No files are staged in this repo.

Each `skills` entry supports:

| Field  | Required | Description                                                            |
| ------ | -------- | ---------------------------------------------------------------------- |
| `name` | yes      | Package name, `owner/repo/skill`, or full URL                          |
| `args` | no       | Additional CLI arguments forwarded verbatim to `npx skills@latest add` |

Each `plugins` entry (Claude only) supports:

| Field    | Required | Description                                     |
| -------- | -------- | ----------------------------------------------- |
| `name`   | yes      | Plugin identifier                               |
| `source` | yes      | `"official"` or `"github"`                      |
| `repo`   | no       | `"owner/repo"` — required when `source: github` |

### 3.5 Hook

Part of the `AgentFrontmatterSchema` (`hooks` field). Three event types:

- `PreToolUse` — runs before a tool call (optionally filtered by `matcher`)
- `PostToolUse` — runs after a tool call
- `Stop` — runs when the session ends

Hooks are native to Claude Code only. On other targets they are silently dropped (the agent still works; hooks just don't fire).

`security.blockedCommands` synthesizes `PreToolUse` hook entries automatically for Claude.

---

## 4. Capability Matrix

| Feature                              |   Claude Code   |       OpenCode       |     Codex     | Cursor  |
| ------------------------------------ | :-------------: | :------------------: | :-----------: | :-----: |
| Native agents                        |        ✓        |          ✓           |       ✓       |    ✓    |
| Native skills/commands               |        ✓        |          ✓           |       ✓       |    ✓    |
| Hooks (PreToolUse/PostToolUse/Stop)  |        ✓        |          —           |       —       |    —    |
| Subagent spawning                    |        ✓        |          ✓           |    comment    |    —    |
| Background execution                 |        ✓        |          —           |       —       |    —    |
| Git worktree isolation               |        ✓        |          —           |       —       |    —    |
| Local MCP servers                    |        ✓        |          ✓           |       ✓       |    ✓    |
| Remote MCP servers                   |        ✓        |          ✓           | localFallback |    ✓    |
| Marketplace plugins                  |        ✓        |    ✓ (TS plugins)    |       —       |    —    |
| Fine-grained tool permissions        |        ✓        |          ✓           |       —       |    —    |
| `contextHints` enforcement           |     comment     |       comment        |    comment    | comment |
| `toolPolicy.avoid`                   | disallowedTools |       comment        |    comment    | comment |
| `toolPolicy.requireConfirmation`     | permissionMode  | permission.edit/bash |    comment    | comment |
| `security.permissionLevel: readonly` |    plan mode    |      deny perms      |    comment    | comment |
| `security.blockedCommands`           | PreToolUse hook |       comment        |    comment    | comment |
| `security.rateLimit`                 |     comment     | rate_limit_per_hour  |    comment    | comment |

**Legend:** ✓ native · comment = emitted as comment in output file · — = not emitted

---

## 5. Build Pipeline

```
ulis build                     # all targets
ulis build --target claude     # single target
ulis build --target claude,cursor
ulis install --yes             # build + deploy (project mode)
ulis install --global --yes    # build + deploy from ~/.ulis/
```

**Internal flow** (`src/build.ts`): `sourceDir` is resolved per invocation (see `src/utils/resolve-source.ts`).

```typescript
const agents = parseAgents(join(sourceDir, "agents"));
const skills = parseSkills(join(sourceDir, "skills"));
const mcp = loadMcp(sourceDir);
const plugins = loadPlugins(sourceDir);

generateClaude(agents, skills, mcp, plugins, sourceDir, join(generatedDir, "claude"), buildConfig);
generateOpencode(agents, skills, mcp, plugins, sourceDir, join(generatedDir, "opencode"), buildConfig);
generateCodex(agents, skills, mcp, sourceDir, join(generatedDir, "codex"), buildConfig);
generateCursor(agents, skills, mcp, sourceDir, join(generatedDir, "cursor"), buildConfig);
```

Parsing validates against Zod schemas and fails fast with a descriptive error if a field is invalid.

---

## 6. Versioning

`ULIS_VERSION = "1.0.0"` is defined in `src/schema.ts`. This is the specification version, not the npm package version.

Migration policy:

- **Patch** (1.0.x): bug fixes, no schema changes.
- **Minor** (1.x.0): additive schema changes (new optional fields). Old configs continue to parse.
- **Major** (x.0.0): breaking schema changes. A migration guide will be provided.

---

## 7. Extending ULIS — Adding a New Adapter

1. Create `src/generators/{target}.ts`:

   ```typescript
   export function generate{Target}(
     agents: readonly ParsedAgent[],
     skills: readonly ParsedSkill[],
     mcp: McpConfig,
     // ...other inputs...
     outDir: string,
   ): void { /* ... */ }
   ```

2. Register it in `src/index.ts`:

   ```typescript
   import { generateTarget } from "./generators/target.js";
   // ...
   case "target":
     generateTarget(agents, skills, mcp, outDir);
     break;
   ```

3. Add scripts to `package.json`:

   ```json
   "build:target": "tsx src/index.ts --target target"
   ```

4. Add `"target"` to `McpServerSchema.targets` values if needed.

For capability mismatches, use `buildPolicyCommentBlock(agent.frontmatter, "md" | "toml" | "mdc")` from `src/utils/policy-comments.ts` to emit unsupported fields as comments.

---

## 8. Examples

**Source:** `.ulis/agents/` — canonical agent definitions
**Generated:** `.ulis/generated/claude/agents/`, `.ulis/generated/opencode/opencode.json`, etc.

Run `ulis build --source tests/fixtures/example-ulis` from a checkout of this repo (or `bun run dev`) to see a full end-to-end example.

**Field reference:** [REFERENCE.md](./REFERENCE.md) — auto-generated from Zod schemas.

---

## 9. Tooling

End-user CLI (see [CLI.md](./CLI.md) for the full surface):

| Command                           | Purpose                                      |
| --------------------------------- | -------------------------------------------- |
| `ulis init [--global]`            | Scaffold `.ulis/` (or `~/.ulis/`)            |
| `ulis build [--target ...]`       | Generate configs under `<source>/generated/` |
| `ulis install [--global] [--yes]` | Build and deploy to platform config dirs     |
| `ulis tui`                        | Interactive TUI                              |

Repo dev scripts:

| Script                  | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `bun run build`         | Bundle `dist/cli.js` + regenerate `dist/schemas/` |
| `bun run dev`           | `ulis build --source tests/fixtures/example-ulis` |
| `bun run test`          | Run test suite                                    |
| `bun run lint`          | `tsc --noEmit`                                    |
| `bun run format`        | Format with oxfmt                                 |
| `bun run gen:schemas`   | Regenerate `dist/schemas/*.schema.json`           |
| `bun run gen:reference` | Regenerate `docs/REFERENCE.md`                    |
| `bun run clean`         | Delete `dist/`                                    |
