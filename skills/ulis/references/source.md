# Source tree

Edit these files. Then `ulis build`. Full fields: https://nejcm.github.io/ulis/REFERENCE

## Layout

```text
.ulis/                    # or ~/.ulis/ or a preset directory
├── config.yaml
├── mcp.yaml
├── permissions.yaml
├── skills.yaml
├── extensions.yaml
├── agents/{name}.md
├── skills/{name}/SKILL.md
├── commands/
├── rules/
└── raw/
    ├── all/
    └── {claude|codex|cursor|opencode|forgecode}/
```

A preset is the same shape, plus optional `preset.yaml` (`name`, `description`) for `ulis preset list` only.

`ulis init` writes empty YAML with `# yaml-language-server: $schema=…` headers. Project scaffolds point at `./node_modules/@nejcm/ulis/schemas`. Add `@nejcm/ulis` as a project dep if the CLI is only global and you want editor schemas.

## `config.yaml`

```yaml
version: 1
name: my-project
# unsupportedPlatformRules: inject | exclude   # OpenCode/Codex/ForgeCode rules
# runner: npx | bunx                            # extensions.yaml; CLI --runner wins
```

## Agents (`agents/{name}.md`)

File stem is the name unless frontmatter `name` is set. Duplicate names fail the build.

```markdown
---
description: Implements focused code changes from a written spec
model: sonnet
tools:
  read: true
  write: true
  edit: true
  bash: true
skills:
  - code-quality
mcpServers:
  - github
platforms:
  claude:
    permissionMode: default
  opencode:
    mode: subagent
  codex:
    sandbox_mode: workspace-write
---

You are a careful implementation agent.
```

Disable on one target:

```yaml
platforms:
  forgecode:
    enabled: false
```

Canonical `model` aliases include `opus`, `sonnet`, `haiku`, `inherit`. Platform blocks override after mapping. Unknown native fields are often best-effort comments, not hard errors.

Agent → MCP name missing from `mcp.yaml` is a **build error**. Agent → skill missing is a warning.

## Local skills (`skills/{name}/SKILL.md`)

Directory name must match frontmatter `name`. Extra files in the directory are copied with the skill.

```markdown
---
name: code-quality
description: Run formatting, type checks, and tests for this repository
argumentHint: "[path-or-test-name]"
tools:
  read: true
  bash: true
---

Use the repo's documented check commands. Fast checks first.
```

These become native skill dirs on each selected platform. They are tracked in the install manifest and **can be pruned**.

## External skills (`skills.yaml`)

Runs `npx skills@latest add …` at install. Not the same as local `skills/`. Not in the ownership manifest.

```yaml
"*":
  skills:
    - name: "@nejcm/ulis"
      args:
        - --skill ulis

claude:
  skills:
    - name: anthropics/skills
      args:
        - --skill pdf
```

`*` applies to every platform; named keys add more. `key` is optional identity for preset merge; default identity is `name`.

## MCP (`mcp.yaml`)

```yaml
servers:
  github:
    type: local
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_TOKEN}

  context7:
    type: remote
    transport: http
    url: https://mcp.context7.com/mcp
    headers:
      CONTEXT7_API_KEY: ${CONTEXT7_API_KEY}

  docs:
    type: remote
    url: https://mcp.example.com/docs
    targets: [claude, cursor]
```

- omit `targets`: every platform
- list: only those platforms
- `targets: []`: disabled
- `localFallback`: for platforms that only take a local command

`${VAR}` is left for the tool to expand. Do not put secrets in the YAML.

## Permissions (`permissions.yaml`)

Only include platforms you mean to set. Omitted platforms keep their own defaults.

```yaml
claude:
  defaultMode: default
  allow:
    - "Read(**)"
    - "Bash(bun test*)"
  deny:
    - "Bash(rm -rf*)"

cursor:
  mcpAllowlist:
    - "github:*"
  terminalAllowlist:
    - bun
    - git
```

On preset merge, list fields such as `claude.allow` are **replaced** by the highest layer that declares them, not concatenated.

## Extensions (`extensions.yaml`)

Re-run every install via `npx` or `bunx` (flag, then `config.yaml` `runner`, then bunx-if-present). Failures warn; install continues. `--skip-extensions` skips the phase.

```yaml
codex:
  extensions:
    - key: supermemory
      name: codex-supermemory@latest
      args: ["install"]
```

## Commands and rules

- `commands/*.md`: slash-command style content where the platform has that concept. Frontmatter needs `description`.
- `rules/**/*.md`: optional `description`, `paths`, `alwaysApply`. Nested folders allowed. For platforms without a rules directory, `unsupportedPlatformRules: inject` (default) adds a rules index to the main instructions file.

## Raw fragments

After generation, files under `raw/` merge into that platform's output.

- `raw/all/` every platform
- `raw/<platform>/` that platform, after `all`
- `raw/common/` is ignored; rename to `all`

`.json` / `.toml` / `.yaml` / `.yml`: objects merge recursively; arrays and scalars at the same path are replaced; **raw wins**. Other files copy as-is. Merge failure: warning, copy as-is.

Use raw for native keys ULIS does not model. Prefer YAML/frontmatter when a canonical field exists.

## After you edit

```bash
ulis build --source <that-tree>
# or from the project: ulis build
```

Fix diagnostics. Install when the user wants destinations updated, with prune/backup called out.
