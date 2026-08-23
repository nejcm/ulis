# ULIS Field Reference

> Auto-generated from Zod schemas. Do not edit manually — run `bun run gen:reference` to regenerate.

This document lists every field for each ULIS entity type.
For narrative explanation of how entities relate and how the build pipeline works, see [SPEC.md](./SPEC.md).

Indented rows are nested fields of the row above them. A `<key>` row stands for an arbitrary
user-chosen key in a map. Types, defaults and constraints are derived from the schemas; descriptions
appear only for fields the schema annotates.

## Agent

YAML frontmatter of a file under `agents/`.

| Field | Type | Required | Default | Constraints | Description |
| ----- | ---- | -------- | ------- | ----------- | ----------- |
| `name` | `string` |  |  | length 1–64, pattern `^(?!-)(?!.*--)(?!.*-$)[a-z0-9-]+$` |  |
| `description` | `string` | ✓ |  |  |  |
| `model` | `string` — one of 69 values \| `string` |  |  |  |  |
| `temperature` | `number` |  |  | ≥ 0, ≤ 1 |  |
| `effort` | `"low"` \| `"medium"` \| `"high"` \| `"max"` |  |  |  |  |
| `tools` | `object` \| `string` | ✓ |  |  |  |
| `maxTurns` | `integer` |  |  | > 0 |  |
| `background` | `boolean` |  |  |  |  |
| `isolation` | `"worktree"` \| `"none"` |  |  |  |  |
| `memory` | `"user"` \| `"project"` \| `"local"` \| `"none"` |  |  |  |  |
| `skills` | `string`[] |  |  |  |  |
| `hooks` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`PreToolUse` | `object`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`matcher` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`command` | `string` | ✓ |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`PostToolUse` | `object`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`matcher` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`command` | `string` | ✓ |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`Stop` | `object`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`command` | `string` | ✓ |  |  |  |
| `mcpServers` | `string`[] |  |  |  |  |
| `contextHints` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`maxInputTokens` | `number` |  |  | > 0 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`excludeFromContext` | `string`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`priority` | `"low"` \| `"normal"` \| `"high"` |  | `"normal"` |  |  |
| `toolPolicy` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`prefer` | `string`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`avoid` | `string`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`requireConfirmation` | `string`[] |  |  |  |  |
| `security` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`permissionLevel` | `"readonly"` \| `"readwrite"` \| `"full"` |  | `"readwrite"` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`blockedCommands` | `string`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`restrictedPaths` | `string`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`requireApproval` | `"write"` \| `"edit"` \| `"bash"` \| `"agent"` \| `"mcp"`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`rateLimit` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`perHour` | `number` | ✓ |  | > 0 |  |
| `color` | `string` — one of 8 values |  |  |  |  |
| `tags` | `string`[] |  | `[]` |  |  |
| `platforms` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`claude` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` — one of 25 values \| `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`permissionMode` | `"default"` \| `"auto"` \| `"acceptEdits"` \| `"dontAsk"` \| `"bypassPermissions"` \| `"plan"` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`disallowedTools` | `string`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`initialPrompt` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`opencode` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` — one of 21 values \| `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`mode` | `"primary"` \| `"subagent"` \| `"all"` |  | `"subagent"` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`top_p` | `number` |  |  | ≥ 0, ≤ 1 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`rate_limit_per_hour` | `number` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`permission` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`edit` | `"ask"` \| `"allow"` \| `"deny"` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`bash` | `"ask"` \| `"allow"` \| `"deny"` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`hidden` | `boolean` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`disable` | `boolean` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`codex` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` — one of 9 values \| `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`sandbox_mode` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model_reasoning_effort` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`nickname_candidates` | `string`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`mcp_servers` | `object` — map of `any` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`<key>` | `any` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`cursor` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` — one of 26 values \| `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`readonly` | `boolean` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`is_background` | `boolean` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`forgecode` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`provider` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`temperature` | `number` |  |  | ≥ 0, ≤ 2 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`top_p` | `number` |  |  | ≥ 0, ≤ 1 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`top_k` | `integer` |  |  | ≥ 1, ≤ 1000 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`max_tokens` | `integer` |  |  | ≥ 1, ≤ 100000 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`max_turns` | `integer` |  |  | > 0 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`max_requests_per_turn` | `integer` |  |  | > 0 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`max_tool_failure_per_turn` | `integer` |  |  | > 0 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`tool_supported` | `boolean` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`user_prompt` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`reasoning` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`effort` | `"low"` \| `"medium"` \| `"high"` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`max_tokens` | `integer` |  |  | > 0 |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`exclude` | `boolean` |  |  |  |  |

## Skill

YAML frontmatter of `skills/<name>/SKILL.md`.

| Field | Type | Required | Default | Constraints | Description |
| ----- | ---- | -------- | ------- | ----------- | ----------- |
| `key` | `string` |  |  |  |  |
| `name` | `string` | ✓ |  | length 1–64, pattern `^(?!-)(?!.*--)(?!.*-$)[\p{Ll}\p{Nd}-]+$` |  |
| `description` | `string` | ✓ |  | length 1–1024 |  |
| `license` | `string` |  |  |  |  |
| `compatibility` | `string` |  |  | length 1–500 |  |
| `metadata` | `object` — map of `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`<key>` | `string` |  |  |  |  |
| `allowed-tools` | `string` |  |  |  |  |
| `argumentHint` | `string` |  |  |  |  |
| `userInvocable` | `boolean` |  | `true` |  |  |
| `allowModelInvocation` | `boolean` |  | `true` |  |  |
| `allowImplicitInvocation` | `boolean` |  | `true` |  |  |
| `model` | `string` — one of 69 values \| `string` |  |  |  |  |
| `effort` | `"low"` \| `"medium"` \| `"high"` \| `"max"` |  |  |  |  |
| `isolation` | `"fork"` \| `"none"` |  |  |  |  |
| `tools` | `object` \| `string` |  |  |  |  |
| `hooks` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`PreToolUse` | `object`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`matcher` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`command` | `string` | ✓ |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`PostToolUse` | `object`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`matcher` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`command` | `string` | ✓ |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`Stop` | `object`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`command` | `string` | ✓ |  |  |  |
| `paths` | `string` \| `string`[] |  |  |  |  |
| `category` | `string` |  |  |  |  |
| `tags` | `string`[] |  | `[]` |  |  |
| `version` | `string` |  |  |  |  |
| `platforms` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`claude` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` — one of 25 values \| `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`shell` | `"bash"` \| `"powershell"` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`opencode` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` — one of 21 values \| `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`codex` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` — one of 9 values \| `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`displayName` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`shortDescription` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`iconSmall` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`iconLarge` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`brandColor` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`defaultPrompt` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`mcpDependencies` | `object`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`type` | `"mcp"` | ✓ |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`value` | `string` | ✓ |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`description` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`transport` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`url` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`cursor` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` — one of 26 values \| `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`forgecode` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  | `true` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`model` | `string` |  |  |  |  |

## MCP Config

Fields of `mcp.yaml`.

| Field | Type | Required | Default | Constraints | Description |
| ----- | ---- | -------- | ------- | ----------- | ----------- |
| `servers` | `object` — map of `object` |  | `{}` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`<key>` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`type` | `"local"` \| `"remote"` | ✓ |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`transport` | `"http"` \| `"sse"` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`url` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`command` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`env` | `object` — map of `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`<key>` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`headers` | `object` — map of `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`<key>` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`localFallback` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`command` | `string` | ✓ |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] | ✓ |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`enabled` | `boolean` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`disabled` | `boolean` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`targets` | `string`[] |  |  |  |  |

## Skills Config

Fields of `skills.yaml`.

| Field | Type | Required | Default | Constraints | Description |
| ----- | ---- | -------- | ------- | ----------- | ----------- |
| `*` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`skills` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  | Command-line fragments; each item may contain an option and its value. |
| `claude` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`skills` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  | Command-line fragments; each item may contain an option and its value. |
| `opencode` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`skills` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  | Command-line fragments; each item may contain an option and its value. |
| `codex` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`skills` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  | Command-line fragments; each item may contain an option and its value. |
| `cursor` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`skills` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  | Command-line fragments; each item may contain an option and its value. |
| `forgecode` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`skills` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  | Command-line fragments; each item may contain an option and its value. |

## Extensions Config

Fields of `extensions.yaml`.

| Field | Type | Required | Default | Constraints | Description |
| ----- | ---- | -------- | ------- | ----------- | ----------- |
| `*` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`extensions` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  |  |
| `claude` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`extensions` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  |  |
| `opencode` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`extensions` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  |  |
| `codex` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`extensions` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  |  |
| `cursor` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`extensions` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  |  |
| `forgecode` | `object` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;`extensions` | `object`[] |  | `[]` |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`key` | `string` |  |  |  |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`name` | `string` | ✓ |  | pattern `^[^-\s]\S*$` |  |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`args` | `string`[] |  |  |  |  |

## Preset metadata

Fields of `preset.yaml` at the root of a preset source. Display metadata only.

| Field | Type | Required | Default | Constraints | Description |
| ----- | ---- | -------- | ------- | ----------- | ----------- |
| `name` | `string` |  |  |  |  |
| `description` | `string` |  |  |  |  |
| `version` | `integer` |  |  |  |  |
