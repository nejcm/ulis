---
title: Examples
---

<!-- markdownlint-disable MD025 -->

# Examples

This page shows small, copyable examples for each `.ulis/` source type. Put these files under a project `.ulis/` directory, or under `~/.ulis/` when using global mode.

## Minimal Tree

```text
.ulis/
├── config.yaml
├── mcp.yaml
├── permissions.yaml
├── plugins.yaml
├── skills.yaml
├── agents/
│   └── builder.md
├── skills/
│   └── code-quality/
│       └── SKILL.md
├── commands/
│   └── format-then-lint.md
├── rules/
│   └── typescript.md
└── raw/
    ├── common/
    │   └── AGENTS.md
    ├── opencode/
    │   └── opencode.json
    └── codex/
        └── config.toml
```

## `config.yaml`

`config.yaml` identifies the source tree and controls a few build-wide defaults.

```yaml
version: 1
name: my-project

# For targets without a native rules directory, append a rules index to the
# main instructions file. Use "exclude" to skip rules for those targets.
unsupportedPlatformRules: inject
```

## Agents

Agents are Markdown files in `agents/`. The file stem becomes the agent name unless `name` is provided.

```markdown
## <!-- agents/builder.md -->

description: Implements focused code changes from a written spec
model: sonnet
temperature: 0.2
tools:
read: true
write: true
edit: true
bash: true
search: true
agent: - reviewer
skills:

- code-quality
  mcpServers:
- github
  contextHints:
  maxInputTokens: 80000
  priority: high
  toolPolicy:
  requireConfirmation: - bash
  security:
  permissionLevel: readwrite
  blockedCommands: - git push --force
  requireApproval: - bash
  tags:
- core
  platforms:
  claude:
  permissionMode: default
  cursor:
  readonly: false
  is_background: true
  opencode:
  mode: subagent
  rate_limit_per_hour: 20
  codex:
  sandbox_mode: workspace-write
  forgecode:
  provider: anthropic

---

You are a careful implementation agent. Read the relevant code and tests before editing.
Keep changes small, explain trade-offs, and run the narrowest useful verification.
```

Disable an agent for a specific target with `enabled: false`:

```yaml
platforms:
  codex:
    enabled: false
```

## Skills

Skills are directories under `skills/`. Each directory must contain `SKILL.md`, and the frontmatter `name` must match the directory name.

```markdown
## <!-- skills/code-quality/SKILL.md -->

name: code-quality
description: Run formatting, type checks, and tests for the current repository
argumentHint: "[path-or-test-name]"
tools:
read: true
bash: true
isolation: fork
paths:

- "src/\*\*"
- "tests/\*\*"
  tags:
- quality
  platforms:
  claude:
  shell: bash
  codex:
  displayName: Code Quality
  shortDescription: Run repository quality checks
  brandColor: "#334155"
  cursor:
  enabled: true

---

Use the repository's documented commands. Prefer fast, focused checks first, then broader checks when the change touches shared behavior.
```

Supporting files can live beside `SKILL.md`:

```text
skills/code-quality/
├── SKILL.md
└── config/
    └── eslint.config.js
```

## MCP Servers

MCP servers live in `mcp.yaml`. Omit `targets` to apply a server to every target, provide a list to restrict it, or use `targets: []` to disable it.

```yaml
servers:
  github:
    type: local
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_TOKEN}

  context7:
    type: remote
    transport: http
    url: https://mcp.context7.com/mcp
    headers:
      Authorization: Bearer ${CONTEXT7_TOKEN}
    localFallback:
      command: npx
      args:
        - -y
        - "@context7/mcp-server"

  internal-docs:
    type: remote
    url: https://mcp.example.com/docs
    targets:
      - claude
      - cursor
```

`localFallback` is used for targets that only support local command-based MCP servers.

## Commands

Commands are Markdown files in `commands/`. They are emitted to targets that support slash-command style content.

```markdown
## <!-- commands/format-then-lint.md -->

description: Format the repo, then run linting
model: sonnet
agent: builder
subtask: true
platforms:
opencode:
agent: builder
subtask: true

---

Run the repository formatter first. If it changes files, summarize the changes.
Then run lint/typecheck and fix any issues caused by the formatting pass.
```

## Rules

Rules are Markdown files in `rules/`. Nested directories are supported.

```markdown
## <!-- rules/typescript/coding-style.md -->

description: TypeScript style and safety rules
paths:

- "src/\*_/_.ts"
- "tests/\*_/_.ts"
  alwaysApply: false
  platforms:
  claude:
  enabled: true
  cursor:
  enabled: true
  codex:
  enabled: true

---

Prefer explicit return types on exported functions.
Keep validation at module boundaries and avoid widening types with `any`.
```

For platforms without native rule files, `unsupportedPlatformRules: inject` adds a rules index to the platform's main instruction file.

## Permissions

`permissions.yaml` configures target-level permission defaults. Use only the sections for platforms you need.

```yaml
claude:
  defaultMode: default
  allow:
    - "Read(**)"
    - "Bash(bun test*)"
  ask:
    - "Bash(git push*)"
  deny:
    - "Bash(rm -rf*)"
  additionalDirectories:
    - "../shared-docs"

opencode:
  permission:
    edit: ask
    bash:
      "bun test*": allow
      "git push*": ask
      "*": deny

codex:
  approvalMode: on-request
  sandbox: workspace-write
  trustedProjects:
    "C:\\Work\\Personal\\ulis": trusted

cursor:
  mcpAllowlist:
    - "github:*"
    - "context7:resolve-library-id"
  terminalAllowlist:
    - bun
    - git status
```

## Plugins

`plugins.yaml` declares Claude Code marketplace plugins. Sections can be platform-specific or use `"*"` as a shared section.

```yaml
claude:
  plugins:
    - name: frontend-design
      source: official
    - name: everything-claude-code
      source: github
      repo: affaan-m/everything-claude-code
```

## External Skills

`skills.yaml` installs external skills through `npx skills@latest add`. This is separate from local skills under `skills/<name>/SKILL.md`.

```yaml
"*":
  skills:
    - name: mattpocock/skills/grill-me

claude:
  skills:
    - name: anthropics/skills
      args:
        - --skill
        - mcp-builder

cursor:
  skills:
    - name: github:acme/internal-skills
      args:
        - --skill
        - repo-review
```

## Raw Overrides

Raw files are merged after generation. Put shared files under `raw/common/`, and target-specific files under `raw/<platform>/`.

```json
// raw/opencode/opencode.json
{
  "model": "anthropic/sonnet",
  "mcp": {
    "local-docs": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@acme/docs-mcp"]
    }
  }
}
```

```toml
# raw/codex/config.toml
model = "gpt-5.4"
approval_policy = "on-request"

[sandbox_workspace_write]
network_access = false
```

```markdown
<!-- raw/common/AGENTS.md -->

# Project Instructions

Always read `docs/SPEC.md` before changing generator behavior.
```

Config files (`.json`, `.toml`, `.yaml`, `.yml`) are deep-merged into generated files with the same relative path. Other files are copied as-is.

## Presets

Presets live under `~/.ulis/presets/<name>/` and can contain the same source files as a normal `.ulis/` tree.

```text
~/.ulis/presets/typescript/
├── preset.yaml
├── skills.yaml
└── rules/
    └── typescript.md
```

```yaml
# preset.yaml
name: typescript
description: Shared TypeScript agents, rules, and skills
```

Apply presets when building or installing:

```bash
ulis build --preset typescript
ulis install --preset team-default,typescript --yes
```
