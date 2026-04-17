# ULIS — Unified LLM Interface Specification

Version `1.0.0` · Source: `src/schema.ts` · Targets: Claude Code, OpenCode, Codex, Cursor

---

## 1. Overview

ULIS is a build system that lets you define AI agent configurations **once** and compile them into the native format expected by each supported tool. You write canonical entity definitions in `.ai/global/`, run `bun run build`, and get ready-to-deploy configs in `generated/`.

```
.ai/global/                   generated/
├── agents/*.md       ─────►  ├── claude/   (agents/, commands/, settings.json, rules/)
├── skills/*/         ─────►  ├── opencode/ (opencode.json, agents/, skills/)
│   SKILL.md                  ├── codex/    (config.toml, agents/*.toml, AGENTS.md)
├── mcp.json          ─────►  └── cursor/   (agents/*.mdc, skills/, mcp.json)
├── plugins.json
├── guardrails.md
└── build.config.json   ◄─── optional: per-platform overrides over BUILD_CONFIG defaults
```

**Why it exists:** Claude Code, OpenCode, Codex, and Cursor all have incompatible config formats. Without ULIS you maintain four separate, drift-prone config trees. ULIS keeps one source of truth and compiles it.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Source: .ai/global/                                    │
│  agents/*.md  skills/*/SKILL.md  mcp.json  plugins.json │
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

## 2.1 Build Configuration (`.ai/global/build.config.json`)

All machine-specific or platform-tunable constants live in `src/config.ts` under `BUILD_CONFIG.platforms.<tool>`. To override any leaf field for your repo, create `.ai/global/build.config.json` with the same shape — it is **deep-merged** on top of the defaults at build time, so you only specify what you want to change.

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

An autonomous task executor. Defined in `.ai/global/agents/{name}.md` with YAML frontmatter + a Markdown prompt body.

```yaml
# .ai/global/agents/builder.md
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

A composable, invocable capability. Defined as a directory `.ai/global/skills/{name}/SKILL.md`. Both the prompt and associated files (scripts, templates) live in the same directory.

```yaml
# .ai/global/skills/code-quality/SKILL.md
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

Defined once in `.ai/global/mcp.json`. Each server may declare a `targets` list to restrict it to specific platforms.

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

Defined in `.ai/global/plugins.json`. The file is keyed by platform name or the special `"*"` wildcard:

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
bun run build                  # all targets
bun run build:claude           # single target
bun run build --target cursor  # same via flag
```

**Internal flow** (`src/build.ts`): `aiDir` is `join(repoRoot, ".ai", "global")`.

```typescript
const agents = parseAgents(join(aiDir, "agents"));
const skills = parseSkills(join(aiDir, "skills"));
const mcp = parseMcpConfig(join(aiDir, "mcp.json"));
const plugins = parsePluginsConfig(join(aiDir, "plugins.json"));

generateClaude(
  agents,
  skills,
  mcp,
  plugins,
  aiDir,
  join(generatedDir, "claude"),
  buildConfig,
);
generateOpencode(
  agents,
  skills,
  mcp,
  plugins,
  aiDir,
  join(generatedDir, "opencode"),
  buildConfig,
);
generateCodex(
  agents,
  skills,
  mcp,
  aiDir,
  join(generatedDir, "codex"),
  buildConfig,
);
generateCursor(
  agents,
  skills,
  mcp,
  aiDir,
  join(generatedDir, "cursor"),
  buildConfig,
);
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

**Source:** `.ai/global/agents/` — canonical agent definitions
**Generated:** `generated/claude/agents/`, `generated/opencode/opencode.json`, etc.

Run `bun run build` to see a full end-to-end example using the project's own agents.

**Field reference:** [REFERENCE.md](./REFERENCE.md) — auto-generated from Zod schemas.

---

## 9. Tooling

| Script                                            | Purpose                                     |
| ------------------------------------------------- | ------------------------------------------- |
| `bun run build`                                   | Build all targets                           |
| `bun run build:{claude\|opencode\|codex\|cursor}` | Build single target                         |
| `bun run test`                                    | Run test suite (54 tests)                   |
| `bun run gen:schemas`                             | Regenerate `schemas/*.json` from Zod        |
| `bun run gen:reference`                           | Regenerate `docs/REFERENCE.md` from Zod     |
| `bun run lint`                                    | TypeScript type check                       |
| `bun run clean`                                   | Delete `generated/`                         |
| `bun run install:configs`                         | Deploy `generated/` to platform config dirs |
