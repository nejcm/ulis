# ulis — Agent Guide

Source for the `@nejcm/ulis` CLI: a single source of truth for AI tool configs. It reads a user-owned `.ulis/` tree (project-local) or `~/.ulis/` (global) and generates native configs for Claude Code, Codex, OpenCode, Cursor and ForgeCode.

TypeScript bundled with `tsup` (Node 20.3+, ESM — `engines.node` in `package.json`). Dev runtime: Bun. CLI framework: `cac`. Validation: `zod` v4.

This repo has no `CLAUDE.md`, and should not get one. `AGENTS.md` is the single agent instruction file — the same model the tool implements, and `.claude/skills/add-platform` is a symlink to `.agents/add-platform`, not a copy. Add instructions here; if a harness needs its own file, symlink it.

## Before you start

- [`CONTEXT.md`](CONTEXT.md) — glossary. Use these terms when describing changes back to me: source vs destination, remote source, trust gate, preset layer vs preset source, raw fragment, ownership manifest, managed vs unmanaged entry, prune, preserved native config.
- [`.agents/add-platform/`](.agents/add-platform/) — the checklist for adding a platform target. Read it before touching `src/platforms.ts`.
- [`docs/SPEC.md`](docs/SPEC.md) architecture, [`docs/CLI.md`](docs/CLI.md) CLI surface, [`docs/TESTING.md`](docs/TESTING.md) what the suite covers and what it deliberately omits. [`docs/REFERENCE.md`](docs/REFERENCE.md) is the generated field-level schema reference — regenerate it with `bun run gen:reference` after a schema change.
- [`archive/`](archive/) — archive of old plans and docs. These might not be relevant anymore but are kept for reference.

## Blast radius

`ulis install` writes into real config directories, and with `--global` into `$HOME`: `~/.claude/`, `~/.codex/`, `~/.cursor/`, `~/.forge/`, `~/.config/opencode/`. Two defaults matter (`src/install.ts`):

- **`prune` defaults to on** — install deletes destination agents and local skills that appear in the manifest but not in the current generated set.
- **`backup` defaults to off** — nothing is copied aside before overwrite.

So:

- Never run `ulis install` (or a preset install) against a real destination to test a change. Build instead — `bun run dev` writes only to `example/generated/`.
- If you must exercise the install path, pass an explicit home/dest base pointing at a temp directory. Every install entry point takes one; that is how `src/install.test.ts` does it. `bun run dev:install` does this for you: it copies `example/` into a fresh temp directory and installs there, so nothing reaches this repo's own `.claude/`, `.codex/` or `.cursor/`.
- The prune and manifest reconciliation logic is the code that deletes user files. Changes there need a test proving unmanaged entries survive.

## What we never compromise on

- **No bundled canonical content.** The CLI parses, validates, generates. Anything user-facing is scaffolded by `ulis init` or read from the user's tree. `example/` is a reference config, not shipped content.
- **Deterministic output.** Same source in, byte-identical generated files out. No timestamps, no map-iteration order, no `Date.now()` in generated content.
- **Preserve what we did not write.** Unmanaged destination entries and allowlisted native config (MCP servers, hooks, Codex trusted projects, `.forge.toml`) survive an install.
- **New runtime dependencies need a reason.** The dependency list is short on purpose.

## Key conventions

- **Zod v4.** Use `z.toJSONSchema(schema, { target: "draft-7" })`, as `src/tools/gen-json-schema.ts` and `src/tools/gen-reference.ts` both do. Never reach for `zod-to-json-schema` — it is v3-shaped and emits empty schemas for v4 constructs, which is exactly how `docs/REFERENCE.md` ended up as five empty headings before 0.8.0. It is no longer a dependency; don't reintroduce it.

- **Bundler scope.** `tsup.config.ts` emits `dist/cli.js` (Node) and `dist/tui.js` (Bun-only). Keep `@opentui/core` in `external` for both so Bun resolves the platform-native package. CJS deps such as `gray-matter` rely on dynamic `require` and break if forced into the ESM bundle.
- **The TUI needs Bun.** OpenTUI's renderer initializes through Bun's FFI and throws under Node. `ulis tui` runs in-process under Bun; under Node it re-launches `dist/tui.js` with a discovered `bun` binary (`src/tui/launcher.ts`) and mirrors the child's exit code. Keep `@opentui/core` imports confined to `src/tui.ts` and `src/tui/` — `src/tui/launcher.test.ts` enforces this.
- **Source resolution precedence:** `--source <path>` → `--global` (`~/.ulis/`) → `./.ulis/` (CWD only, no walk-up). Errors hint at the right `ulis init` variant.
- **`raw/all/` is injected into every platform's output; `raw/<platform>/` is target-only.** Raw values win at the same path. `raw/common/` is not recognized.
- **Scaffold templates are duplicated on purpose.** `src/scaffold/` holds both `*.template.yaml` files and inlined template constants in `index.ts`. Change one, change the other — the file header says so.

## Where to start in the source

- `src/platforms.ts` — the platform registry. Every platform change starts here: `PLATFORMS`, `PLATFORM_DIRS`, labels, descriptions, per-OS path maps.
- `src/build.ts` / `src/install.ts` — orchestration, ownership manifest, prune.
- `src/generators/platforms/<name>/` — per-target output. `shared/`, `writer.ts` and `source-dirs.ts` sit alongside.
- `src/schema/` + `src/parsers/` — the input contract.

Full layout is in [`docs/SPEC.md`](docs/SPEC.md); it is maintained and this file is not the place to mirror it.

## Hit every surface

A change to one platform is almost never one file. For any edit under `src/generators/platforms/<p>/`, check each:

- **The other four adapters.** `PLATFORMS` is opencode, claude, codex, cursor, forgecode. Asymmetry is allowed but must be deliberate, not accidental.
- `src/platforms.ts` — registry entries and path maps.
- `src/install/platforms.ts` and `src/install.ts` — merge vs copy, preserved native config.
- `src/generators/shared/` and `writer.ts` — cross-platform behavior lives here first.
- `tests/golden-artifacts.ts` — hand-written expected output, one block per platform.
- `example/` — `raw/all/`, `raw/<platform>/`, and the yaml manifests.
- `docs/SPEC.md` capability matrix and adapter guide.
- `src/scaffold/` — both the `*.template.yaml` file and its inlined twin.

## Reverse states

Every toggle needs its off-switch documented in the same change:

| Feature                                    | Off-switch                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| prune stale managed entries (default on)   | `--no-prune` — stale entries are kept and become unmanaged                                                                               |
| rebuild before install (default on)        | `--skip-rebuild` — refused, `-y` included, if `<source>/generated/` was built from a remote source; there is no clone left to re-preview |
| run `extensions.yaml` entries              | `--skip-extensions`                                                                                                                      |
| install external skills from `skills.yaml` | `--skip-external-skills`                                                                                                                 |
| overwrite in place (default)               | `--backup` — writes timestamped `*.backup.*` files                                                                                       |

There is no `ulis uninstall`. Removal happens only via prune against a shrinking generated set, so anything written outside the ownership manifest is permanently unmanaged. Don't add a write path that skips the manifest.

## Commands

Fast loop while iterating on a generator or parser — no build needed:

```sh
bun run dev                                # build against example/, writes example/generated/
bun test src/generators/platforms/codex    # scope to what you touched
```

Before completing a task, from the repo root, in order:

1. `bun run format` — oxfmt.
2. `bun run lint` — `tsc --noEmit`.
3. `bun run test` — unit + integration.

If you changed generators, parsers, schemas, or CLI wiring, also:

4. `bun run build` — `tsup`, then schema generation, then preset copy. Produces `dist/cli.js`, `dist/tui.js`, `schemas/`.
5. `node dist/cli.js build --source example` — smoke the Node bundle end to end.

If you changed Zod schemas: `bun run gen:schemas` (it runs as part of `bun run build`) to refresh the
publishable JSON Schemas under `schemas/`, and `bun run gen:reference` to refresh `docs/REFERENCE.md`.

There is no fixture regeneration command. `tests/golden-artifacts.ts` is hand-maintained TypeScript string constants, not snapshots — when generated output changes on purpose, edit that file by hand and say so in the diff.

## Platform documentation

Claude Code https://code.claude.com/docs/en/overview · Codex https://developers.openai.com/codex · OpenCode https://opencode.ai/docs · Cursor https://cursor.com/docs · Forge Code https://forgecode.dev/docs/
