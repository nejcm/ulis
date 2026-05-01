---
title: Field Reference
---

# ULIS Field Reference

This page summarizes the most-used fields for each ULIS config type. For architecture and behavior details, see [SPEC](./SPEC.md).

## Agent (`agents/*.md`)

Agents are Markdown files with YAML frontmatter and a prompt body.

| Field         | Type     | Notes                                                                                   |
| ------------- | -------- | --------------------------------------------------------------------------------------- |
| `description` | `string` | Short purpose shown in generated configs.                                               |
| `model`       | `string` | Canonical alias (for example `opus`, `sonnet`, `haiku`, `inherit`) mapped per platform. |
| `tools`       | `object` | Capability toggles like `read`, `write`, `edit`, `bash`, `search`, `browser`, `agent`.  |
| `security`    | `object` | Restrictions like blocked commands and rate limits.                                     |
| `toolPolicy`  | `object` | Preferences and confirmation requirements where supported.                              |
| `platforms`   | `object` | Per-target overrides (`claude`, `codex`, `cursor`, `opencode`).                         |

## Skill (`skills/<name>/SKILL.md`)

Skills are directory-based definitions (`SKILL.md` plus optional supporting files).

| Field          | Type     | Notes                                                     |
| -------------- | -------- | --------------------------------------------------------- |
| `description`  | `string` | Human-readable intent for the skill.                      |
| `argumentHint` | `string` | Optional usage hint for arguments.                        |
| `tools`        | `object` | Required capability set for the skill execution.          |
| `isolation`    | `string` | Execution isolation mode (for platforms that support it). |

## MCP Config (`mcp.yaml`)

MCP servers are defined once and filtered by target when needed.

| Field              | Type                  | Notes                                                               |
| ------------------ | --------------------- | ------------------------------------------------------------------- |
| `servers`          | `record`              | Map of server name to local/remote server config.                   |
| `type`             | `string`              | Typically `local` or `remote`.                                      |
| `command` / `args` | `string` / `string[]` | Local process launch command and arguments.                         |
| `url`              | `string`              | Remote MCP endpoint URL.                                            |
| `env` / `headers`  | `record`              | Environment and header values (supports `${VAR}` placeholders).     |
| `targets`          | `string[]`            | Optional platform filter (`claude`, `codex`, `cursor`, `opencode`). |

## Plugins Config (`plugins.yaml`)

Claude marketplace plugin installs.

| Field                                        | Type          | Notes                           |
| -------------------------------------------- | ------------- | ------------------------------- |
| `*`, `claude`, `opencode`, `codex`, `cursor` | `object`      | Per-platform sections.          |
| `plugins`                                    | `PluginRef[]` | Plugin entries for the section. |

### PluginRef

| Field    | Type     | Notes                                              |
| -------- | -------- | -------------------------------------------------- |
| `name`   | `string` | Plugin identifier.                                 |
| `source` | `string` | `official` or `github`.                            |
| `repo`   | `string` | Required when `source` is `github` (`owner/repo`). |

## Skills Config (`skills.yaml`)

External skill installs per platform.

| Field                                        | Type         | Notes                                         |
| -------------------------------------------- | ------------ | --------------------------------------------- |
| `*`, `claude`, `opencode`, `codex`, `cursor` | `object`     | Per-platform sections.                        |
| `skills`                                     | `SkillRef[]` | Skills installed via `npx skills@latest add`. |

### SkillRef

| Field  | Type       | Notes                                                   |
| ------ | ---------- | ------------------------------------------------------- |
| `name` | `string`   | Package, repo/skill, or URL accepted by the skills CLI. |
| `args` | `string[]` | Extra CLI args forwarded to the installer.              |

## Preset metadata (`presets/<name>/preset.yaml`) {#preset-metadata}

Presets are optional ULIS source trees (same layout as `.ulis/`) living under `~/.ulis/presets/<name>/` or bundled with the package. The **preset identifier** is the folder name `<name>`; that is what you pass to `ulis build --preset` / `ulis install --preset`.

Optional `preset.yaml` in the preset root supplies metadata for `ulis preset list` and the TUI. It does not change the preset’s CLI name (still the parent folder).

| Field         | Type      | Notes                                                           |
| ------------- | --------- | --------------------------------------------------------------- |
| `name`        | `string`  | Display title in listings (defaults to folder name if omitted). |
| `description` | `string`  | Short blurb shown in `ulis preset list` and the TUI.            |
| `version`     | `integer` | Optional version integer (schema metadata only).                |
