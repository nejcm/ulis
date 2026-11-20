---
title: Specification
---

# ULIS — Unified LLM Interface Specification

Version `1.0.0` · Source: `src/schema/` · Targets: Claude Code, OpenCode, Codex, Cursor, ForgeCode, Antigravity, Hermes Agent, Devin · CLI: `@nejcm/ulis`

---

## 1. Overview

ULIS is a CLI (`ulis`) that lets you define AI agent configurations **once** and compile them into the native format expected by each supported tool. You write canonical entity definitions in `.ulis/` (project) or `~/.ulis/` (global), run `ulis build` (or `ulis install` to also deploy), and get ready-to-deploy configs under `<source>/generated/`.

```
.ulis/                        .ulis/generated/
├── agents/*.md       ─────►  ├── claude/   (agents/, commands/, rules/, skills/, settings.json, .claude.json)
├── skills/*/         ─────►  ├── opencode/ (opencode.json, agents/, commands/, rules/, skills/, settings.json)
│   SKILL.md                  ├── codex/    (config.toml, agents/*.toml, rules/, skills/, AGENTS.md)
├── mcp.yaml          ─────►  ├── cursor/   (agents/*.mdc, rules/, skills/, mcp.json, permissions.json)
│                             ├── forgecode/ (AGENTS.md, .forge/agents, .forge/rules, .forge/skills, .forge/.mcp.json)
│                             ├── antigravity/ (agents/*.md, rules/*.md, skills/, mcp_config.json)
│                             ├── hermes/   (skills/, config.yaml)
│                             └── devin/    (agents/*.md, rules/*.md, skills/, mcp_config.json, config.json)
├── skills.yaml          (external skill installs)
├── extensions.yaml      (third-party CLI extension installs via npx/bunx)
├── permissions.yaml
└── config.yaml          ◄─── version + name + optional install + runner settings

.ulis/generated/<platform>/.ulis-provenance.json ◄─── remote sources for that platform output, if any
```

`ulis build` writes `generated/<platform>/.ulis-provenance.json` whenever a resolved preset carries a remote URL.
The marker is `{ version: 1, remoteSources: string[] }`; URLs are redacted, deduplicated, and sorted. The writer
creates it immediately after clearing that platform directory and before writing any payload, so provenance lives
and is destroyed with the output it describes. A local build writes no marker.

`ulis install --skip-rebuild` reads the selected platforms' markers. A malformed marker, an unsupported version,
or any recorded remote source makes install refuse before writing a destination. Re-run
`ulis install --preset <url>` to rebuild and review the source. A root-level `generated/.ulis-provenance.json` from
the pre-release format also refuses; only a full `ulis build` without `--target` removes that opaque legacy flag.

`ulis install` deploys the generated tree to the per-platform destination (`./.claude/`, `./.forge/`, `./.agents/`, etc.). Existing unmanaged destination agents and skills are left in place unless a generated entry has the same native name; replacing an entry the previous manifest did not record logs a warning, since directories such as `.agents/` are shared with other tools. Codex `config.toml`, Claude `settings.json`, and global `.claude.json` use base-first overlays: generated values overwrite matching paths and absent native values remain. Codex and ForgeCode TOML comments and ordering outside generated paths are preserved. Fresh native configs are copied byte-for-byte; installs that leave the native values unchanged retain the existing bytes. Other native configs preserve their allowlisted values or files, such as MCP server maps and ForgeCode `.forge.toml`. The ownership manifest records generated top-level MCP server names across all platforms, including raw fragments, and per-project MCP servers in Claude global `~/.claude.json` raw fragments. Removed managed servers are pruned; unmanaged servers survive. `--no-prune` retains stale MCP servers and makes them unmanaged. Older manifests have no MCP ownership data, so pre-existing servers remain unmanaged until ULIS generates them again.

**Why it exists:** Claude Code, OpenCode, Codex, Cursor, ForgeCode, Antigravity, Hermes Agent, and Devin all have incompatible config formats. Without ULIS you maintain separate, drift-prone config trees. ULIS keeps one source of truth and compiles it.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Source: .ulis/  (or ~/.ulis/)                          │
│  agents/  skills/  mcp.yaml  skills.yaml                │
└────────────────────────┬────────────────────────────────┘
                         │ gray-matter + Zod parse
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Canonical bundle                                       │
│  ParsedAgent[]  ParsedSkill[]  McpConfig                │
└──────────┬──────────┬──────────┬──────────┬────────────┘
           │          │          │          │
    generateClaude  generateOpencode  generateCodex  generateCursor  generateForgecode  generateAntigravity  generateHermes  generateDevin
           │          │          │          │               │                │               │
           ▼          ▼          ▼          ▼               ▼                ▼               ▼
     generated/claude  opencode  codex    cursor        forgecode        antigravity       hermes          devin
```

Each `generate*` function:

1. Reads the canonical bundle
2. Maps canonical types (model aliases, tool groups, permission levels) to platform specifics
3. Emits native files (YAML frontmatter, JSON, TOML, MDC)

Provider adapters own their own parsing-to-native behavior, generated file layout, and install semantics. Prefer keeping agent, skill, MCP, permission, and install handling inside the relevant platform implementation even when this duplicates some code across adapters. Platform config formats and install locations change independently, so localized duplication is acceptable when it keeps future platform updates isolated. Extract shared helpers only for stable, cross-platform mechanics that are clearly reusable, such as path utilities, environment placeholder rewriting, config merging, or policy comment formatting.

Markdown YAML frontmatter accepts merge keys and shared aliases, but rejects cycles, non-plain values, nesting beyond 100 levels, and walks exceeding 10,000 node visits. Repeated alias references count toward that budget.

Between parsing and generation the orchestrator runs **validators** (`src/validators/`):

- `validateCrossRefs(agents, skills, mcp)` — agent → skill (warn), agent → mcp (**error**), agent → subagent allowlist (warn)
- `validateCollisions(agents, skills)` — duplicate agent or skill names (**error**)
- `validateMcpPlaceholders(mcp)` — `${VAR}` in an MCP server bound for Antigravity, which interpolates nothing (warn, variable name only)

Errors abort the build (exit code 1, no files written). Warnings print and the build proceeds.

Parse and validation failures are reported as **Diagnostics**. A diagnostic includes the source label (`base` or `preset:<name>`), source-relative file, absolute file path, field path, target platform (`claude`, `codex`, `cursor`, `opencode`, `forgecode`, `antigravity`, `all`, or `none`), optional line/column, and a suggested fix when ULIS can infer one. Platform override fields such as `platforms.codex.*` report that platform; wildcard or cross-platform fields report `all`; source-only config errors report `none`.

## 2.1 Build configuration

`config.yaml` holds CLI metadata (`version`, `name`). Local skills generated by ULIS are copied into each selected platform config alongside the rest of the generated platform output.

Platform adapter defaults are internal to ULIS. If you need platform-native output customization, place partial config files under `raw/` (for example `raw/opencode/opencode.json` or `raw/codex/config.toml`). These are merged into the generated output — JSON fragments may contain `//` and `/* */` comments, objects merge recursively, and raw arrays or scalars replace generated values at the same path. See [Source Layout — Raw overrides](./guide/source-layout.md#raw-overrides) for the full rules.

Capability mismatches are handled with **best-effort + comments**: if a target lacks native support for a field, the value is emitted as a comment in the generated file so reviewers can see it, and the build continues (no hard failure).

## 2.2 Presets {#presets}

**Presets** are reusable ULIS source trees. They can be merged into a build before the selected base source (`./.ulis/`, `~/.ulis/`, or `--source`), or installed by themselves with preset-only install. Each preset name resolves to a directory: `~/.ulis/presets/<name>/` is tried first, then bundled presets adjacent to the CLI package. User and bundled trees share the same on-disk layout as a normal source; optional `preset.yaml` carries display metadata only (see [Field Reference — Preset metadata](./REFERENCE.md#preset-metadata)).

Parsed preset projects are merged **in CLI order** (comma-separated `--preset` values), then the base project is merged last so **the base wins** on duplicate entities and conflicting config keys. The same rules apply to `build`, `install`, and the TUI (including its validate action) when presets are selected. Discovery and labeling (`user` vs `bundled`) are implemented in `src/presets.ts` and `src/utils/resolve-presets.ts`. Optional fields for `preset.yaml` are documented under [Preset metadata](./REFERENCE.md#preset-metadata).

Preset-only install (`ulis preset install <names...>` and the TUI Presets screen action) parses and validates only the selected presets, merges them in the requested order, generates selected platform output in a temporary directory, installs that output to the chosen destination, then removes the temporary output. It does not require a project/global source and does not read or merge base source files. Preset `skills.yaml` and `extensions.yaml` entries run during preset-only install; extension runner selection is CLI flag first, then auto-detect (`bunx` if present, otherwise `npx`).

### 2.3 Install ownership

Each selected platform config root stores `.ulis-manifest.json` version 3. It contains validated relative paths for agents and local skill directories installed by ULIS, plus the individual root-relative files the install writes into the config root, which every platform prunes. Optional `mcpServers` records top-level server names; optional `mcpProjectServers` records `[projectPath, serverName]` pairs for global Claude installs, matching `projects[projectPath].mcpServers` in `~/.claude.json`. Project paths are exact native object keys, not filesystem removal targets. Older manifests remain readable and migrate: version 1 carries no root record and prunes no root entries. Version 2 recorded root names rather than files, so a recorded name that is a file is pruned like any other stale entry, while a recorded name that is a directory is pruned only when it is already empty — anything inside it was never recorded as ULIS's own. The manifest excludes external `skills.yaml` installs, extension output, and preserved native config, which the root sweep never deletes. MCP scopes absent from a legacy manifest remain unmanaged until generated again.

Before any selected destination is modified, ULIS reads and validates every selected platform manifest and derives the current managed set from generated output. Missing manifests trigger first-run adoption without pruning. MCP configs first merge without removing stale servers; MCP removal waits until all platform writes succeed. After platform files are installed, ULIS removes `previous managed − current managed`, then atomically writes the current manifest. The one exception is a stale managed root entry under a name the generated output now needs as a file: it is removed before the copy, since the copy cannot proceed over it. If a platform install fails part-way, nothing else is pruned and the manifest becomes the previous entries plus the current entries the copy actually wrote; current entries it never reached stay unrecorded, so an unmanaged file at one of those paths is not claimed. Ownership is path-based, so user edits to a tracked file do not prevent its removal. OpenCode agents are flat `agents/<name>.md`, so OpenCode merges each prompt with the `agent.<name>` entry in `opencode.json` by name. Manifests from older installs that recorded `agents/core/...` or `agents/specialized/...` are still read, and those entries are pruned like any other stale managed path; unmanaged files in those directories are left alone.

Pruning is enabled by default. `--no-prune` retains stale paths and MCP servers but replaces the manifest with the current set, making retained paths unmanaged. Empty or platform-disabled output is authoritative for selected platforms; unselected platform destinations and manifests remain untouched. Backups are taken before installation and therefore contain the prior manifest and any entries later pruned. A platform root that is itself a symlink is backed up as a real copy of the directory it points to, not as another link to the live tree.

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

| Field          | Purpose                                                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`        | Canonical alias: `opus`, `sonnet`, `haiku`, `inherit`. Mapped per-platform.                                                                                                                                                                                                                                      |
| `tools`        | Permission groups: `read`, `write`, `edit`, `bash`, `search`, `browser`, `agent`. Claude: an object that grants nothing becomes `disallowedTools` covering documented built-in tools and `mcp__*`. OpenCode: all-false denies `"*"`; `browser` controls `playwright_*` MCP tools, not arbitrary browser servers. |
| `contextHints` | Advisory window hints. Emitted as comments (no native equivalent on any current target).                                                                                                                                                                                                                         |
| `toolPolicy`   | `prefer`/`avoid` → comments. `requireConfirmation` → native permission controls where supported.                                                                                                                                                                                                                 |
| `security`     | `permissionLevel: readonly` → Claude `plan` mode + OpenCode deny perms. `blockedCommands` → Claude PreToolUse hooks. `rateLimit` → OpenCode `rate_limit_per_hour`.                                                                                                                                               |
| `platforms`    | Per-target overrides. Applied last; they win over derived values from canonical fields.                                                                                                                                                                                                                          |

### 3.2 Skill

A composable, invocable capability. Defined as a directory `.ulis/skills/{name}/SKILL.md`. Both the prompt and associated files (scripts, templates) live in the same directory.

> Skills reference: https://agentskills.io/home

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

- **Claude**: skill directories in `generated/claude/skills/`. Canonical fields become native frontmatter: `argumentHint` → `argument-hint`, `allowModelInvocation: false` → `disable-model-invocation: true`, `userInvocable: false` → `user-invocable: false`, `isolation: fork` → `context: fork`, `tools` → `allowed-tools` (skipped when the source already sets `allowed-tools`), `hooks` → nested Claude hook groups; `effort` and `paths` pass as-is. `platforms.claude` extras win.
- **OpenCode**: skill directories in `generated/opencode/skills/`
- **Codex**: skill directories in `generated/codex/skills/`
- **Cursor**: skill directories in `generated/cursor/skills/`
- **ForgeCode**: skill directories in `generated/forgecode/.forge/skills/`
- **Antigravity**: skill directories in `generated/antigravity/skills/`; the canonical `model` is dropped from `SKILL.md` because Antigravity documents no such field. `platforms.antigravity` extras win.
- **Hermes**: skill directories in `generated/hermes/skills/`, flat (`skills/<name>/SKILL.md`; Hermes walks its skills root recursively, so a flat entry loads next to its bundled category folders). The canonical `model` is dropped; `platforms.hermes` extras win and are the way to set Hermes's own fields — `platforms.hermes.platforms: [linux, macos]` becomes the native `platforms:` OS list, `platforms.hermes.metadata.hermes.{tags,category}` its metadata. Unknown frontmatter keys are tolerated by Hermes's parser.
- **Devin**: skill directories in `generated/devin/skills/`. The canonical `model` and the string `allowed-tools` are dropped with a build warning (Devin takes its own `--model` names such as `opus`, `sonnet`, `swe`, and a list of tools); `platforms.devin` extras win and are the way to set Devin's own fields (`model`, `triggers`, `subagent`, `agent`, `permissions`, a list-form `allowed-tools`).

Commands (`.ulis/commands/*.md`) are emitted for Claude and OpenCode only. `platforms.claude` / `platforms.opencode` take `enabled` (default `true`; `false` skips the command on that platform) and `model`; other keys pass through to that platform's frontmatter.

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

Codex emits native remote MCP `url` configuration, including supported HTTP headers. A remote URL takes precedence over `localFallback`; the fallback branch applies only when no URL is present. See the [Codex config reference](https://developers.openai.com/codex/config-reference/).

Environment variables use `${VAR}` syntax everywhere. The build translates to platform-specific syntax (OpenCode local environment and remote headers use `{env:VAR}`; Cursor uses `${env:VAR}` in `command`, `args`, `env`, `url` and `headers`). Codex interpolates nothing: a local server's `KEY: ${KEY}` becomes `env_vars = ["KEY"]`, a remote header that is exactly `${VAR}` becomes `env_http_headers`, and `Authorization: Bearer ${VAR}` becomes `bearer_token_env_var`; any other placeholder is written literally because Codex has no way to rename or embed a variable. MCP `args` also stay literal, including `${VAR}` and fallback arguments. Pass secrets through same-name `env_vars`, or use a user-owned wrapper that reads its environment. Generators have no diagnostic channel, so ULIS does not warn for these literals.

Antigravity writes `mcp_config.json` (`{ mcpServers }`): a remote server becomes `{ serverUrl, headers? }`, a local one `{ command?, args?, env? }`, and `enabled: false` / `disabled: true` becomes `disabled: true`. `localFallback`, `transport` and `cwd` are not emitted. Antigravity documents no `${VAR}` interpolation, so placeholders are written verbatim and the build warns once per placeholder (name only) for every server that targets Antigravity; set a literal in `raw/antigravity/mcp_config.json` or drop `antigravity` from `targets`. See [Antigravity MCP](https://antigravity.google/docs/mcp). Hermes writes `config.yaml` with `mcp_servers` only: a remote server becomes `{ url, headers? }`, a local one `{ command?, args?, env? }`, `transport: sse` is kept (Hermes otherwise uses Streamable HTTP), and `enabled: false` / `disabled: true` becomes `enabled: false`; `localFallback` and `cwd` are not emitted, and Hermes-only keys such as `tools.include` / `tools.exclude` go in `raw/hermes/config.yaml`, which deep-merges per key. `${VAR}` is written verbatim because Hermes interpolates from the environment and `~/.hermes/.env`. See [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp). Devin writes `mcp_config.json` (`{ mcpServers }`): a remote server becomes `{ url, transport, headers? }` with `transport` `http` unless the source sets `sse`, a local one `{ command, args?, env? }`, and `enabled: false` / `disabled: true` becomes `disabled: true`; a server without its `command` or `url` is omitted with a build warning, `localFallback` and `cwd` are not emitted, and Devin-only keys (`disabledTools`, `oauthClientId`, …) go in `raw/devin/mcp_config.json`. `${VAR}` becomes `${env:VAR}` in `command`, `args`, `env`, `url` and `headers`. See [Devin MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration). [Codex launches stdio arguments unchanged](https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/stdio_server_launcher.rs).

### 3.4 Skill / Extension registry entries

Declarative installs are split into two files:

**`.ulis/skills.yaml`** — external skills installed via `npx skills@latest add`, keyed by platform or the `"*"` wildcard:

```yaml
"*":
  skills:
    - name: mattpocock/skills/productivity/grill-me
    - name: vercel-labs/agent-skills
      args: ["--skill find-skills"]

claude:
  skills:
    - name: anthropics/skills
      args: ["--skill mcp-builder"]

opencode:
  skills:
    - name: some-opencode-skill
```

**Key semantics:**

| File              | Key            | Effect during `ulis install`                                                             |
| ----------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `skills.yaml`     | `"*"`          | `skills` are installed for **all** platforms via `npx skills@latest add -a <each-agent>` |
| `skills.yaml`     | `"<platform>"` | `skills` are installed for that platform only (`-a <agent-name>`)                        |
| `extensions.yaml` | `"*"`          | each `extensions` entry runs once via the resolved runner (e.g. `bunx <name> <args>`)    |
| `extensions.yaml` | `"<platform>"` | runs the entry only when that platform is part of the install target set                 |

External skills are installed by `npx skills@latest add`, which writes into the selected project or global agent config directories. Local skills are generated by ULIS and copied into each platform's skill directory as part of the regular install pipeline.

Each `skills` entry supports:

| Field  | Required | Description                                                            |
| ------ | -------- | ---------------------------------------------------------------------- |
| `name` | yes      | Package name, `owner/repo/skill`, or full URL                          |
| `args` | no       | Additional CLI arguments forwarded verbatim to `npx skills@latest add` |

**`.ulis/extensions.yaml`** — third-party CLI extensions invoked through a package runner. Useful for self-installing packages (e.g. `bunx codex-supermemory@latest install`) that wire themselves into a target tool's config files:

```yaml
codex:
  extensions:
    - key: supermemory
      name: codex-supermemory@latest
      args: ["install"]

claude:
  extensions:
    - name: some-claude-helper@1.2.3
      args: ["setup", "--yes"]
```

Each `extensions` entry supports:

| Field  | Required | Description                                                                   |
| ------ | -------- | ----------------------------------------------------------------------------- |
| `name` | yes      | Package spec (e.g. `codex-supermemory@latest`); passed verbatim to the runner |
| `args` | no       | Arguments appended after `name` in the runner invocation                      |
| `key`  | no       | Friendly identifier used in `ulis install` log lines                          |

**Runner resolution** (precedence): `--runner` CLI flag → `runner` field in `config.yaml` → auto-detect (`bunx` if available on PATH, else `npx`).

Extensions run **last** in the install pipeline (`build → files → skills → extensions`) because most self-installing extensions mutate the very files ulis just deployed. Each entry runs every time `ulis install` runs (no caching in v1). Failures log a warning and the install continues.

### 3.5 Hook

Part of the `AgentFrontmatterSchema` (`hooks` field). Three event types:

- `PreToolUse` — runs before a tool call (optionally filtered by `matcher`)
- `PostToolUse` — runs after a tool call
- `Stop` — runs when the session ends

Hooks are native to Claude Code only. On other targets they are silently dropped (the agent still works; hooks just don't fire).

Claude output always nests each entry as `{ matcher?, hooks: [{ type: command, command }] }`, the native shape; an entry without `matcher` is emitted without one, not flattened.

`security.blockedCommands` synthesizes `PreToolUse` hook entries automatically for Claude: matcher `Bash`, a per-handler `if: "Bash(<command>*)"` permission rule (a `PreToolUse` matcher matches the tool name only), and a fixed command that prints to stderr and exits `2` — the only exit code that blocks the call. The blocked command is never interpolated into the shell command. Claude evaluates `if` best-effort; use `permissions.yaml` `claude.deny` for a hard block.

---

## 4. Capability Matrix

| Feature                              |   Claude Code   |       OpenCode       |    Codex     | Cursor  |  ForgeCode   | Antigravity  | Hermes Agent | Devin   |
| ------------------------------------ | :-------------: | :------------------: | :----------: | :-----: | :----------: | ------------ | ------------ | ------- |
| Native agents                        |        ✓        |          ✓           |      ✓       |    ✓    |      ✓       | ✓            | —            | ✓       |
| Native skills/commands               |        ✓        |          ✓           |      ✓       |    ✓    |      ✓       | ✓            | ✓            | ✓       |
| Rule instruction discovery           |     native      |     global index     | global index | native  | global index | native       | —            | native  |
| Hooks (PreToolUse/PostToolUse/Stop)  |        ✓        |          —           |      —       |    —    |      —       | —            | —            | —       |
| Subagent spawning                    |        ✓        |          ✓           |   comment    |    —    |      —       | —            | —            | —       |
| Background execution                 |        ✓        |          —           |      —       |    ✓    |      —       | —            | —            | —       |
| Git worktree isolation               |        ✓        |          —           |      —       |    —    |      —       | —            | —            | —       |
| Local MCP servers                    |        ✓        |          ✓           |      ✓       |    ✓    |      ✓       | ✓            | ✓            | ✓       |
| Remote MCP servers                   |        ✓        |          ✓           |      ✓       |    ✓    |      ✓       | ✓            | ✓            | ✓       |
| Fine-grained tool permissions        |        ✓        |          ✓           |      —       |    —    |  tools list  | pass-through | —            | ✓       |
| `contextHints` enforcement           |     comment     |       comment        |   comment    | comment |   comment    | comment      | —            | comment |
| `toolPolicy.avoid`                   | disallowedTools |       comment        |   comment    | comment |   comment    | comment      | —            | comment |
| `toolPolicy.requireConfirmation`     | permissionMode  | permission.edit/bash |   comment    | comment |   comment    | comment      | —            | comment |
| `security.permissionLevel: readonly` |    plan mode    |      deny perms      |   comment    | comment |   comment    | comment      | —            | comment |
| `security.blockedCommands`           | PreToolUse hook |       comment        |   comment    | comment |   comment    | comment      | —            | comment |
| `security.rateLimit`                 |     comment     | rate_limit_per_hour  |   comment    | comment |   comment    | comment      | —            | comment |

**Legend:** ✓ native · comment = emitted as comment in output file · — = not emitted

"global index" means the injected rules index references `~/<home>/rules/` and loads only from a global install. OpenCode, Codex and ForgeCode do not discover `AGENTS.md` inside a project-scope config directory (`./.opencode/`, `./.codex/`, `./.forge/`), so a project install's rules index is not loaded; making it load needs scope-aware generation.

Cursor documents no per-subagent `tools` field or deny-all form. Its subagents inherit parent tools, including MCP; ULIS tool lists do not provide an enforced restriction. `readonly` restricts writes, not tool access. See [Cursor subagents](https://cursor.com/docs/subagents).

ForgeCode agents with omitted tools default to no tools, so an all-false canonical object is already restrictive. See [ForgeCode agent tools](https://forgecode.dev/docs/creating-agents/).

Antigravity subagents (`agents/<name>.md`) take `name`, `description`, `tools` and optional `mcpServers` / `skills` lists. Antigravity types `mcpServers` as objects without documenting the entry, so canonical references are not emitted and the build warns once per agent (workspace servers still land in `mcp_config.json`); `skills` names become `skills/<name>` paths, relative to the directory that also holds `agents/`, as the docs' `skills/my-helper-skill` example suggests. `platforms.antigravity.mcpServers` (native objects, passed through verbatim) is the only way to attach servers to a subagent; `platforms.antigravity.skills` replaces the mapped paths. Canonical tools map only to documented names — `read` → `view_file`, `grep_search`; `edit` → `replace_file_content`; `bash` → `run_command`; `agent` → `invoke_subagent` — and `tools` is always emitted, so an all-false object yields `tools: []`. `write`, `search` and `browser` have no documented counterpart, and a string allowlist cannot be mapped to one (it emits `tools: []`); both are listed in a `[ULIS tools]` comment instead of guessed (an unknown tool name hangs the subagent), and the build warns, since Antigravity grants only the listed tools; `platforms.antigravity.tools` silences it. The canonical `model` is dropped (omission means inherit); `platforms.antigravity` passes `model` (`inherit` / `flash` / `pro`), `tools` (replaces the mapped list), `mainAgent`, `subagent`, `commandExecutionPolicy` and anything else straight through. Rules land in `rules/<name>.md` with nested paths flattened (`golang/coding-style.md` → `rules/golang-coding-style.md`; a collision fails the build) and a `trigger`: `alwaysApply` → `always_on`, `paths` → `glob` with `globs` joined by `", "` as the docs show, `description` alone → `model_decision`, nothing → `always_on`. Antigravity truncates rule files past 24,000 bytes, and the build warns for a larger generated rule. Permissions and hooks are not emitted. See [Antigravity subagents](https://antigravity.google/docs/subagents), [rules](https://antigravity.google/docs/rules) and [skills](https://antigravity.google/docs/skills).

Install targets `./.agents/` (project) and `~/.gemini/config/` (global). `.agents/` is also written by the `skills` CLI and other tools, hence the replacement warning above; the `skills` CLI's global Antigravity directory (`~/.gemini/antigravity/skills`) differs from the one ULIS writes.

Hermes Agent has no user-defined agents (delegation is per call, via `delegate_task`), so agents, rules, commands, permissions and hooks are not emitted; ULIS never generates `SOUL.md` or any other persona or context file, though a `raw/all/` or `raw/hermes/` fragment can place one (the trust preview announces raw fragments). Skills land flat in `skills/<name>/`; Hermes walks its skills root recursively, so they load beside the bundled category folders. A ULIS skill named like a bundled category folder (`mlops`, …) replaces that whole folder — the "not written by a previous ULIS install" warning fires, as on every platform. Install targets `~/.hermes/` (global) and `./.hermes/` (project; skills only, loaded after `hermes skills trust`). `~/.hermes/config.yaml` is Hermes-owned and rewritten by `hermes config set`; ULIS merges `mcp_servers` only — every other key (unless a `raw/hermes/config.yaml` fragment sets it) and every unmanaged server survive, stale managed servers are pruned — and because the file is re-serialised, **comments are lost whenever the merge changes anything** (an unchanged file is left byte-identical, and the install warns when comments were dropped). Run with `--backup` first; it copies all of `~/.hermes/`, including `.env`, sessions and logs. `.agents/skills/` belongs to the Antigravity target and is never written by Hermes. See [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) and [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp).

Devin's target covers Devin CLI and Devin Local (Devin Desktop's agent), which share one harness and file layout. It emits subagents, skills, rules, MCP servers and permissions. Hooks are not emitted: Devin reads the `hooks` in `.claude/settings.json`, `.claude/settings.local.json` and their `~/.claude/` twins itself while `read_config_from.claude` is on, so the Claude target's hooks already reach it. Install targets `./.devin/` (project) and `~/.config/devin/` (global; `%APPDATA%\devin\` on Windows); `XDG_CONFIG_HOME` is ignored. Rules use the Antigravity mapping — `rules/<name>.md`, nested names flattened (a collision fails the build), `trigger` `always_on` / `glob` / `model_decision` — except that `globs` is a YAML list (verified against Devin CLI 3000.14, which rejects a string), with no size warning, since Devin documents no limit. `global_rules.md` is a reserved name: ULIS never writes, claims or prunes it, raw fragments included. A project install keeps rules in `.devin/rules/`; a global install writes them to `~/.devin/rules/` (Devin's global rules dir, not under `~/.config/devin/`) in a second pass, managed and pruned like every other entry and recorded under `globalRulesEntries` in the `~/.config/devin/` manifest. On Windows ULIS also uses `~/.devin/rules/`, inferred from the docs' home-relative path and not verified on Windows. Nothing else in `~/.devin/`, which Devin Desktop uses for its own data, is read or written: a symlinked or non-directory `~/.devin/rules`, a dangling symbolic link anywhere on that path, a rules path whose real location overlaps the config directory (for example `~/.devin` linked to `~/.config/devin`), or a generated `rules` entry that is not a real lowercase directory, fails the install before anything is written, and `--backup` copies `~/.devin/rules/` to `devin-rules.<timestamp>.backup` beside the config backup. ULIS-generated Devin output never goes in `.agents/`, which belongs to the Antigravity target. Subagents (`agents/<name>.md`; custom subagents are _experimental_ upstream) take `name`, `description` and `allowed-tools`. Canonical tools map to the documented tool names — `read` → `read`, `grep`, `glob`; `write` → `write`; `edit` → `edit`, `apply_patch`; `bash` → `exec`; `search` and `browser` → `webfetch`; `agent` → `run_subagent`, `read_subagent` (no allowlist; Devin disables both inside a subagent unless `max-nesting` is set). Granting all six tool groups (`agent` or not, since subagent tools are off inside a subagent anyway) omits `allowed-tools`, which Devin reads as all tools. An all-false object or a string allowlist (Claude tool names) maps to nothing, and `allowed-tools: []` has no documented meaning, so ULIS never emits it from canonical tools (an explicit `platforms.devin` value passes through) and omits the field instead — the subagent then gets every tool — with the canonical tools listed in a `[ULIS tools]` comment and a build warning unless `platforms.devin.allowed-tools` (or its Devin alias `tools`) is set. A listed `allowed-tools` withholds every Devin tool ULIS does not map (`todo_write`, `skill`, …; whether MCP tools need listing is not verified). The canonical `model` is dropped with a build warning (unset, Devin uses its default subagent model, not the parent's); `platforms.devin` passes `model`, `allowed-tools` or its alias `tools` (written as `allowed-tools`, replacing the mapped list; `allowed-tools` wins if both are set), `max-nesting` and anything else straight through. Canonical `skills`, `mcpServers` and `hooks` are not emitted (`mcpServers` with a build warning; servers still reach Devin through `mcp_config.json`); `contextHints`, `toolPolicy` and `security` become comments. Canonical agent names allow no underscore, so only a `platforms.devin.name` can shadow the built-in `subagent_explore` / `subagent_general` profiles, which Devin skips with a warning; the build warns too. `devin doctor` validates agent profiles without signing in. Devin also loads project subagents from `.agents/agents/`, where the Antigravity target writes its own, so a project install for both targets gives Devin two definitions of an agent; which one wins is not documented. `mcp_config.json` needs Devin CLI v3000.3 / Local 3.6 or later (earlier versions read `mcpServers` from `config.json`). It is merged: every key outside managed `mcpServers` and every unmanaged server survive, stale managed servers are pruned; it is parsed with comments allowed, kept byte-identical when nothing changes, and re-serialised without comments (with a warning) when something does. `permissions.devin` (`allow` / `deny` / `ask`, Devin rule strings such as `Exec(git)`, `Read(src/**)`, `Fetch(domain:npmjs.org)`, `mcp__github__*`) is written to `config.json` as `{ permissions: { allow, deny, ask } }`, all three lists always present (an undeclared one is `[]`). `config.json` is emitted only when `permissions.devin` is set or a `raw/devin/config.json` (or `raw/all/config.json`) fragment exists. Devin owns the file (saved approvals, and in the global file `agent.model`, `theme_mode` and other user-only keys), so the install overlays it: the existing file is the base, every key ULIS does not generate survives, and the generated `permissions` lists replace the existing ones. **Saved "Allow for project" / "Allow globally" approvals live in those lists, so setting `permissions.devin` overwrites them on every install**; add the rules you want to keep to `permissions.devin`. With `permissions.devin` unset and no raw fragment, an existing `config.json` is left byte-identical. Removing `permissions.devin` later leaves the last-written `permissions` in place, now unmanaged: ULIS cannot tell its rules from approvals Devin saved since, and nothing about the file is recorded in the ownership manifest. `config.json` is parsed with comments allowed and kept byte-identical when nothing changes. `config.local.json` (local approvals) and `mcp_config.local.json` (gitignored per-user servers) are reserved names that ULIS never writes, claims or prunes, so a raw fragment with one of those names is not installed. Devin also reads `.claude/skills/`, `.codex/skills/`, `.agents/skills/` and Claude, Cursor and OpenCode MCP configs, so a skill or server installed for several targets can appear twice; turn an import off with a `raw/devin/config.json` fragment such as `{ "read_config_from": { "claude": false, "codex": false } }`, which the install merges into the existing `config.json`. `claude: false` turns off every Claude Code import — rules, skills, MCP servers and hooks — and ULIS emits no hooks for Devin, so that also stops Claude hooks running in Devin. External skills from `skills.yaml` reach Devin through the same shared `skills` CLI call as every other target (`-a devin`). Limitations of that CLI, not of ULIS: with several targets it writes a shared `.agents/skills/` copy and links to it, it writes its own lock file (`skills-lock.json` at the project root; globally `$XDG_STATE_HOME/skills/.skill-lock.json`, or `~/.agents/.skill-lock.json` when that is unset), and on Windows its global Devin path is `~/.config/devin/skills/`, not `%APPDATA%\devin\skills\`. Cloud Devin gets no output of its own: it reads skills from those same repository directories and `AGENTS.md` in cloned repos, and keeps everything else in its web UI. Windsurf/Cascade paths (`~/.codeium/`, workflows, memories) are out of scope. See [Devin subagents](https://docs.devin.ai/cli/subagents), [tool names](https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks#tool-names-you-can-match), [skills](https://docs.devin.ai/cli/extensibility/skills/overview), [rules](https://docs.devin.ai/cli/extensibility/rules), [MCP](https://docs.devin.ai/cli/extensibility/mcp/configuration), [permissions](https://docs.devin.ai/cli/reference/permissions), [hooks](https://docs.devin.ai/cli/extensibility/hooks/overview) and [configuration import](https://docs.devin.ai/cli/reference/configuration/read-config-from).

Zed has no ULIS target. It reads skills only from `.agents/skills/` in trusted worktrees and from `~/.agents/skills/`, so a project install of Antigravity covers Zed's project skills; a global Antigravity install writes `~/.gemini/config/skills/`, which Zed does not read. Zed loads a project's root `AGENTS.md` unless a higher-priority instruction file such as `.rules` matches. Its MCP servers and tool permissions live in a commented `settings.json` that ULIS does not edit. See [Zed skills](https://zed.dev/docs/ai/skills.html) and [instructions](https://zed.dev/docs/ai/instructions.html).

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
const analysis = analyzeProject({ sourceDir, logger, presets });

for (const target of activeTargets) {
  const result = generate(target, analysis.project);
  writeResult(result, join(outputDir, target), target, logger);
}
```

`generate()` (`src/generators/index.ts`) dispatches through the `GENERATORS` map to `generateClaude`, `generateOpencode`, `generateCodex`, `generateCursor`, `generateForgecode`, `generateAntigravity`, `generateHermes`, and `generateDevin`. Each returns a pure `GenerationResult`; `writeResult` (`src/generators/writer.ts`) owns the filesystem side effects.

Parsing validates against Zod schemas and reports localized diagnostics for broken Markdown frontmatter, YAML/JSON config syntax, and schema failures. Semantic validators reuse the same diagnostic shape for cross-reference and collision failures.

---

## 6. Versioning

The ULIS specification version is `1.0.0`. This is the specification version, not the npm package version.

Migration policy:

- **Patch** (1.0.x): bug fixes, no schema changes.
- **Minor** (1.x.0): additive schema changes (new optional fields). Old configs continue to parse.
- **Major** (x.0.0): breaking schema changes. A migration guide will be provided.

---

## 7. Extending ULIS — Adding a New Adapter

1. Create `src/generators/platforms/{target}/index.ts`:

   ```typescript
   export function generate{Target}(project: ProjectBundle): GenerationResult { /* ... */ }
   ```

2. Register it in the `GENERATORS` map in `src/generators/index.ts`:

   ```typescript
   import { generateTarget } from "./platforms/target/index.js";
   // ...
   const GENERATORS = {
     // ...
     target: generateTarget,
   };
   ```

3. Add `"target"` to `PLATFORMS`, `PLATFORM_LABELS`, `PLATFORM_DESCRIPTIONS`, and `PLATFORM_DIRS` in `src/platforms.ts`, and wire the install branch in `src/install.ts`.

4. Add `"target"` to `McpServerSchema.targets` values if needed.

For capability mismatches, use `buildPolicyCommentBlock(agent.frontmatter, "md" | "toml" | "mdc")` from `src/utils/policy-comments.ts` to emit unsupported fields as comments.

---

## 8. Examples

**Source:** `.ulis/agents/` — canonical agent definitions
**Generated:** `.ulis/generated/claude/agents/`, `.ulis/generated/opencode/opencode.json`, etc.

Run `ulis build --source example` from a checkout of this repo (or `bun run dev`) to see a full end-to-end example.

**Field reference:** [REFERENCE.md](./REFERENCE.md) — auto-generated from Zod schemas.

---

## 9. Tooling

End-user CLI (see [CLI.md](./CLI.md) for the full surface):

| Command                           | Purpose                                      |
| --------------------------------- | -------------------------------------------- |
| `ulis init [--global]`            | Scaffold `.ulis/` (or `~/.ulis/`)            |
| `ulis build [--target ...]`       | Generate configs under `<source>/generated/` |
| `ulis install [--global] [--yes]` | Build and deploy to platform config dirs     |
| `ulis tui`                        | Interactive dashboard for source workflows   |

Repo dev scripts:

| Script                  | Purpose                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `bun run build`         | Bundle `dist/cli.js` + Bun-only `dist/tui.js`; regenerate published schemas |
| `bun run dev`           | `ulis build --source example`                                               |
| `bun run test`          | Run test suite                                                              |
| `bun run lint`          | `tsc --noEmit`                                                              |
| `bun run format`        | Format with oxfmt                                                           |
| `bun run gen:schemas`   | Regenerate `dist/schemas/*.schema.json` and `schemas/*.schema.json`         |
| `bun run gen:reference` | Regenerate `docs/REFERENCE.md`                                              |
| `bun run clean`         | Delete `dist/` and `schemas/`                                               |
