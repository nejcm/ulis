# ULIS Field Reference

> Auto-generated from Zod schemas. Do not edit manually — run `bun run gen:reference` to regenerate.

This document lists every field for each ULIS entity type.
For narrative explanation of how entities relate and how the build pipeline works, see [SPEC.md](./SPEC.md).

## Agent

## Skill

## MCP Config

## Plugins Config

`plugins.json` is a map from platform key to a `{ plugins?, skills? }` object. The special key `"*"` applies to all platforms.

### Top-level keys

| Key          | Type            | Description                                                  |
| ------------ | --------------- | ------------------------------------------------------------ |
| `"*"`        | `PlatformEntry` | Skills installed for every platform during `install:configs` |
| `"claude"`   | `PlatformEntry` | Skills + marketplace plugins installed for Claude Code only  |
| `"opencode"` | `PlatformEntry` | Skills installed for OpenCode only                           |
| `"codex"`    | `PlatformEntry` | Skills installed for Codex only                              |
| `"cursor"`   | `PlatformEntry` | Skills installed for Cursor only                             |

### PlatformEntry

| Field     | Type          | Default | Description                                                              |
| --------- | ------------- | ------- | ------------------------------------------------------------------------ |
| `skills`  | `SkillRef[]`  | `[]`    | Skills to install via `npx skills@latest add` during `install:configs`   |
| `plugins` | `PluginRef[]` | —       | Claude Code only — marketplace plugins installed via `claude plugin add` |

### SkillRef

| Field  | Type       | Required | Description                                                            |
| ------ | ---------- | -------- | ---------------------------------------------------------------------- |
| `name` | `string`   | yes      | Package name, `owner/repo/skill`, or full URL passed to the skills CLI |
| `args` | `string[]` | no       | Extra flags forwarded verbatim to `npx skills@latest add`              |

### PluginRef (Claude only)

| Field    | Type     | Required | Description                                     |
| -------- | -------- | -------- | ----------------------------------------------- |
| `name`   | `string` | yes      | Plugin identifier                               |
| `source` | `string` | yes      | `"official"` or `"github"`                      |
| `repo`   | `string` | no       | `"owner/repo"` — required when `source: github` |
