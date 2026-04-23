# ulis

> Unified LLM Interface Specification — one config source, five AI tools.

`ulis` is a CLI that compiles a single canonical config tree (agents, skills, MCP servers, plugins, permissions) into native configs for [Claude Code](https://claude.ai/code), [OpenCode](https://opencode.ai), [Codex](https://github.com/openai/codex), [Cursor](https://cursor.com), and [ForgeCode](https://forgecode.dev/docs/).

You write the source once under `.ulis/` (per project) or `~/.ulis/` (global), and `ulis` generates and installs the native files each tool expects.

> **Status:** `0.0.1-alpha`. APIs and file layout may still change.

---

## Install

```bash
npm i -g @nejcm/ulis
```

or

```bash
bun add -g @nejcm/ulis
```

Requires Node 20+. Works with both Node and Bun runtimes.

---

## Quick start — project mode

Scaffold a `.ulis/` folder inside an existing project:

```bash
cd my-project
ulis init
```

This creates:

```
.ulis/
├── config.yaml          # version + project name
├── mcp.yaml             # MCP server definitions
├── permissions.yaml     # per-platform access rules
├── plugins.yaml         # Claude marketplace plugin installs
├── skills.yaml          # external skill installs (per platform)
├── agents/              # agent definitions (.md with frontmatter)
├── skills/              # skill definitions (SKILL.md per skill)
├── commands/            # slash commands
└── raw/                 # platform-specific fragments copied verbatim
```

It also appends `/.ulis/generated/` to `.gitignore`.

Add some agents/skills/MCP servers, then:

```bash
ulis install
```

This builds into `.ulis/generated/<platform>/` and then deploys to `./.claude/`, `./.codex/`, `./.cursor/`, `./.opencode/`, and ForgeCode locations (`./.forge/`) inside your project. Pass `-y` / `--yes` to skip confirmation prompts.

---

## Quick start — global mode

Maintain one canonical config for every project on your machine:

```bash
ulis init --global      # creates ~/.ulis/
# edit ~/.ulis/... to taste
ulis install --global   # deploys to ~/.claude/, ~/.codex/, ~/.cursor/, ~/.opencode/, ~/.forge/
```

---

## Commands

| Command        | Purpose                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `ulis init`    | Scaffold `.ulis/` in the current project (or `~/.ulis/` with `--global`) |
| `ulis build`   | Generate configs into `<source>/generated/` without installing           |
| `ulis install` | Build, then deploy generated configs to the target platform directories  |
| `ulis tui`     | Launch the interactive terminal UI                                       |

### Common flags

| Flag                  | Applies to         | Description                                                                |
| --------------------- | ------------------ | -------------------------------------------------------------------------- |
| `-g`, `--global`      | all                | Operate on `~/.ulis/` and home-level install targets (`~/.claude/`…)       |
| `--source <path>`     | `build`, `install` | Override the source directory; with `--global`, installs still target home |
| `--target <platform>` | `build`, `install` | Comma-separated list: `claude`, `codex`, `cursor`, `opencode`, `forgecode` |
| `-y`, `--yes`         | `install`          | Skip confirmation prompts                                                  |
| `--no-rebuild`        | `install`          | Skip the build step and deploy existing `generated/`                       |
| `--backup`            | `install`          | Back up existing platform dirs (`<dir>.backup.YYYYMMDD_HHMMSS`)            |

### Source resolution

`ulis build` / `ulis install` pick the source directory in this order:

1. `--source <path>` if provided — fails if missing.
2. `--global` → `~/.ulis/` — fails with an `ulis init --global` hint if missing.
3. Otherwise → `./.ulis/` in the current directory (**no walk-up**) — fails with an `ulis init` hint if missing.

For `ulis install --source <path> --global`, the explicit source is built, then files are installed to home-level targets.

---

## Source layout (`.ulis/`)

### `config.yaml`

```yaml
# yaml-language-server: $schema=./node_modules/@nejcm/ulis/dist/schemas/config.schema.json
version: 1
name: my-project
```

### `mcp.yaml`

MCP servers shared across platforms. Use the `targets` field to restrict a server.

```yaml
servers:
  github:
    type: local
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_PAT}
  linear:
    type: remote
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: Bearer ${LINEAR_API_KEY}
    targets: ["opencode"] # only OpenCode sees this server
```

| `targets`               | Meaning                                 |
| ----------------------- | --------------------------------------- |
| _omitted_               | Applies to every platform               |
| `["opencode","claude"]` | Applies only to the listed platforms    |
| `[]`                    | Disabled — excluded from every platform |

Reference secrets as `${VAR}` — the build translates to each platform's env-var syntax. Hardcoded secrets fail validation.

### `agents/*.md`

Each agent is a Markdown file with YAML frontmatter + a prompt body. Example:

```markdown
---
description: Implements features from specs
model: sonnet
tools:
  read: true
  write: true
  edit: true
  bash: true
security:
  blockedCommands:
    - git push --force
  rateLimit:
    perHour: 20
---

You are a focused implementation agent. Read specs carefully before writing code.
```

See [docs/REFERENCE.md](docs/REFERENCE.md) for the full frontmatter schema.

### `skills/<name>/SKILL.md`

Each skill is a directory containing a `SKILL.md` (frontmatter + body) plus any supporting files (scripts, templates).

### `plugins.yaml`

Claude Code marketplace plugins installed via `claude plugin add`. Only `claude` is supported today:

```yaml
claude:
  plugins:
    - name: frontend-design
      source: official
    - name: everything-claude-code
      source: github
      repo: affaan-m/everything-claude-code
```

### `skills.yaml`

External skills installed via `npx skills@latest add`. Keyed by platform or `"*"` (all platforms):

```yaml
"*":
  skills:
    - name: mattpocock/skills/grill-me
    - name: vercel-labs/agent-skills
      args: ["--skill", "find-skills"]

claude:
  skills:
    - name: anthropics/skills
      args: ["--skill", "mcp-builder"]
```

Each entry runs `npx skills@latest add <name> -a <agent> --yes [args...]` per target platform.

### `permissions.yaml`

Per-platform read/write/bash allowlists and deny rules. See [example/permissions.yaml](example/permissions.yaml) for a working example.

### `raw/` and `commands/`

Copied verbatim into generated outputs. Use `raw/` for platform-specific fragments that `ulis` doesn't model directly.

---

## Install behaviour

| Tool        | Strategy         | Target (project mode) | Target (global mode) |
| ----------- | ---------------- | --------------------- | -------------------- |
| OpenCode    | Overwrite        | `./.opencode/`        | `~/.opencode/`       |
| Claude Code | Merge (additive) | `./.claude/`          | `~/.claude/`         |
| Codex       | Overwrite        | `./.codex/`           | `~/.codex/`          |
| Cursor      | Merge (additive) | `./.cursor/`          | `~/.cursor/`         |
| ForgeCode   | Merge (additive) | `./.forge/`           | `~/.forge/`          |

`settings.json`, `.claude.json`, `mcp.json`, and ForgeCode's `.forge/.mcp.json` are deep-merged so user content outside `ulis`-managed keys is preserved. With `--backup`, existing platform directories/files are copied aside before overwriting.

---

## Schema autocomplete

Scaffolded YAML files include a `# yaml-language-server: $schema=…` header pointing at `./node_modules/@nejcm/ulis/dist/schemas/*.schema.json`. VS Code's YAML extension picks these up automatically when the package is installed.

Schemas are also regenerated on every `npm run build` via `bun run gen:schemas`.

---

## Development

Clone the repo:

```bash
bun install
bun run dev        # builds against example/
bun test           # runs the suite (~96 tests)
bun run build      # bundles dist/cli.js + regenerates dist/schemas
```

### Dev scripts

| Script                  | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `bun run build`         | Bundle CLI (`tsup`) and regenerate JSON schemas                     |
| `bun run dev`           | Run `ulis build` against the `example/` directory                   |
| `bun run ulis <args>`   | Run the CLI from source (`tsx src/cli.ts …`)                        |
| `bun run tui`           | Launch the interactive TUI from source                              |
| `bun run test`          | Run the unit + integration suite                                    |
| `bun run lint`          | `tsc --noEmit`                                                      |
| `bun run format`        | Format with [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) |
| `bun run gen:schemas`   | Regenerate `dist/schemas/*.schema.json` from Zod                    |
| `bun run gen:reference` | Regenerate `docs/REFERENCE.md`                                      |

### Repo layout

```
src/
  cli.ts                   # cac entry point (compiled to dist/cli.js)
  commands/                # init, install, build, tui
  parsers/                 # agent, skill, mcp, plugins, permissions loaders
  generators/              # claude, opencode, codex, cursor, forgecode
  schema/                  # Zod schemas (ulis-config, agent, mcp, …)
  scaffold/                # inline templates used by `ulis init`
  utils/                   # config-loader, resolve-source, fs, logger, …
  validators/              # cross-ref + collision checks
  tui.ts                   # interactive UI
  tools/                   # gen-json-schema, gen-reference
example/                   # reference example config
tests/
docs/
  SPEC.md                  # architecture + entity model
  REFERENCE.md             # auto-generated field reference
```

### Testing

The `bun run dev` command builds against `example/` so the CLI works without any `.ulis/` in the current directory.
The `bun run dev:install --source example` commands installs the example into global configs.

---

## Docs

- [docs/SPEC.md](docs/SPEC.md) — architecture, entity model, capability matrix, versioning, extension guide.
- [docs/REFERENCE.md](docs/REFERENCE.md) — auto-generated field reference for every schema.
- [docs/CLI.md](docs/CLI.md) — full CLI reference (commands, flags, exit codes, examples).

---

## License

ISC
