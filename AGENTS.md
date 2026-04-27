# Agent instructions

## About this repository

This repo is the source for the `@nejcm/ulis` CLI — a single source of truth for AI tool configs (Claude Code, Codex, OpenCode, Cursor, ForgeCode). The CLI reads a user-owned `.ulis/` tree (project-local) or `~/.ulis/` (global) and generates native configs for each platform.

The package ships **no bundled canonical content**. The tree under [`example/`](example/) is a reference example config.

Stack: TypeScript bundled with `tsup` (Node 20+, ESM). Dev runtime: Bun. CLI framework: `cac`. Validation: `zod` v4. See [`docs/SPEC.md`](docs/SPEC.md) for architecture, [`docs/CLI.md`](docs/CLI.md) for the CLI surface, [`docs/REFERENCE.md`](docs/REFERENCE.md) for field-level schema docs.

## Key conventions

- **Zod v4 only.** Use `z.toJSONSchema(schema, { target: "draft-7" })` for JSON Schema generation — never `zod-to-json-schema` (v3-only, produces empty schemas against v4).
- **Bundler scope.** `tsup.config.ts` uses `noExternal: ["@cel-tui/core"]` — that dep ships raw TS and must be bundled. Do not widen `noExternal` to everything; CJS deps (e.g. `gray-matter`) rely on dynamic `require` and will break if forced into the ESM bundle.
- **No bundled canonical content.** The CLI is a parser/validator/generator only. Anything user-facing must be scaffolded by `ulis init` or read from the user's `.ulis/` tree.
- **Source resolution precedence:** `--source <path>` → `--global` (`~/.ulis/`) → `./.ulis/` (CWD only, no walk-up). Errors hint at the right `ulis init` variant.

## Where to find configuration documentation

When you need tool-specific configuration behavior:

| Tool            | Documentation                            |
| --------------- | ---------------------------------------- |
| **Claude Code** | https://code.claude.com/docs/en/overview |
| **Codex**       | https://developers.openai.com/codex      |
| **OpenCode**    | https://opencode.ai/docs                 |
| **Cursor**      | https://cursor.com/docs                  |

## Source layout

```yaml
src/
  cli.ts                # cac entry point (bundled to dist/cli.js)
  commands/             # init, install, build, tui
  parsers/              # agent, skill, mcp, plugins, permissions
  generators/           # claude, opencode, codex, cursor, forgecode
  schema/               # Zod schemas
  scaffold/             # `ulis init` templates (inlined strings)
  validators/           # cross-ref + collision checks
  utils/                # config-loader, resolve-source, fs, logger, …
  tui.ts                # interactive UI
  tools/                # gen-json-schema, gen-reference
example/                # reference example config
dist/                   # tsup output (cli.js + schemas/) — gitignored
```

## Before completing a task

Run from the repo root (in order):

1. `bun run format` — format with oxfmt.
2. `bun run lint` — TypeScript check (`tsc --noEmit`).
3. `bun run test` — unit + integration tests.

If you changed generators, parsers, schemas, or CLI wiring, also:

4. `bun run build` — rebuild `dist/cli.js` and `dist/schemas/`.
5. `node dist/cli.js build --source example` — smoke the bundled CLI end-to-end.

If you changed Zod schemas specifically, also run `bun run gen:reference` to refresh [`docs/REFERENCE.md`](docs/REFERENCE.md).

Never commit `dist/` or `example/generated/` — both are build artifacts.
