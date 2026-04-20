# Agents

Canonical agent definitions shared across all AI tools. Each file is a Markdown document with YAML frontmatter that controls how the agent is configured per tool.

## File Format

```markdown
---
description: "One-line purpose"
model: opus | sonnet | haiku
temperature: 0.0–1.0
tools:
  read: true
  write: false
  edit: false
  bash: false
  search: true
tags: [core, read-only]

opencode:
  mode: subagent
  rate_limit_per_hour: 20
claude:
  mapping: rule | skill | skip
codex:
  mapping: instruction | skip
cursor:
  mapping: skip
---

[Full agent prompt — shared across all tools]
```

### Fields

| Field            | Values                    | Description                                                   |
| ---------------- | ------------------------- | ------------------------------------------------------------- |
| `model`          | `opus`, `sonnet`, `haiku` | Model tier (mapped to current model IDs at build time)        |
| `temperature`    | `0.0–1.0`                 | Lower = more deterministic. Use `0.0` for migrations/security |
| `tools.*`        | `true/false`              | Which tools this agent may use                                |
| `claude.mapping` | `rule`, `skill`, `skip`   | How the agent appears in Claude Code                          |
| `codex.mapping`  | `instruction`, `skip`     | How the agent appears in Codex                                |

## How It's Used

The build system reads these files and generates:

- **OpenCode** → agent blocks in `opencode.json` + copied to `generated/opencode/agents/`
- **Claude Code** → orchestration table in `generated/claude/rules/common/agents.md`
- **Codex** → embedded as instruction sections in `generated/codex/config.toml`
- **Cursor** → skipped (no native agent support)

## Adding a New Agent

1. Create `.ai/global/agents/<name>.md` with frontmatter and prompt content
2. Set `claude.mapping`, `codex.mapping` as appropriate
3. Run `bun run build` from the repo root to regenerate all tool configs
4. Run `bun run install:configs` to deploy

## Temperature Strategy

| Range     | Agents                                                                                                                          | Rationale                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `0.0`     | migration, security, tester, penetration-tester                                                                                 | Deterministic — no guessing      |
| `0.1–0.2` | builder, refactor, devops, documentation, performance, reviewer, golang-pro, database-optimizer, ai-engineer, security-engineer | Consistent but slightly adaptive |
| `0.3`     | architect, planner, debugger, market-researcher, project-idea-validator, competitive-analyst                                    | Exploratory analysis             |

## Agent Catalog

| Agent                      | Description                                    | Model  |
| -------------------------- | ---------------------------------------------- | ------ |
| architect                  | System design and architectural decisions      | opus   |
| builder                    | Feature implementation                         | sonnet |
| debugger                   | Root cause analysis and bug fixes              | sonnet |
| devops                     | CI/CD, infrastructure, platform engineering    | sonnet |
| documentation              | Docs and code documentation                    | sonnet |
| migration                  | Database and API migration safety              | sonnet |
| performance                | Profiling and optimization                     | sonnet |
| planner                    | Feature planning and task breakdown            | opus   |
| refactor                   | Code quality and dead code cleanup             | sonnet |
| reviewer                   | Code review and quality checks                 | sonnet |
| security                   | Code security review (read-only)               | opus   |
| tester                     | Test strategy and coverage                     | sonnet |
| **ai-engineer**            | End-to-end AI systems, MLOps, ethical AI       | opus   |
| **competitive-analyst**    | Competitive intelligence and benchmarking      | sonnet |
| **database-optimizer**     | Query tuning, indexing, schema analysis        | sonnet |
| **golang-pro**             | Idiomatic Go, concurrency, microservices       | sonnet |
| **market-researcher**      | Market sizing, consumer research, strategy     | sonnet |
| **penetration-tester**     | Authorized security testing and exploitation   | opus   |
| **project-idea-validator** | Idea validation, competitor teardown, go/no-go | sonnet |
| **security-engineer**      | DevSecOps, zero-trust, compliance automation   | opus   |
