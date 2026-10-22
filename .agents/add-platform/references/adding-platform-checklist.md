# Adding A ULIS Platform Target

Use this checklist when adding a brand-new ULIS output target such as a new Claude/Cursor/Codex-style platform.

## 1. Establish The Canonical Platform Entry

Start with `src/platforms.ts`. This is the source of truth for:

- `PLATFORMS`
- the `Platform` type
- labels and descriptions
- install directory names in `PLATFORM_DIRS`
- canonical ordering used by `uniquePlatforms()` and `parsePlatformList()`

Why it matters: platform ordering and labels are reused across build, install, workflow helpers, and the TUI.

## 2. Add Build Support

Add the generator implementation under `src/generators/platforms/<target>/`, then register it in the `GENERATORS` map in `src/generators/index.ts`.

Audit:

- generator imports
- `GENERATORS` map entry
- generator argument shape
- whether the target should receive permissions, rules, extensions, or unsupported-platform settings

Compare against the closest existing generator instead of treating all generators as equivalent. The current build wiring is intentionally asymmetric.

## 3. Add Install Support

Wire the new target into `src/install.ts`.

Audit:

- install `switch (platform)` handling
- merge vs copy behavior
- destination directory logic through `platformConfigDir()`
- global skill installer support in `SKILL_PLATFORM_AGENT_NAMES`
- platform-specific side effects like extension installation or top-level file placement

Why it matters: some targets install into a single config directory, while others also merge files like `settings.json`, `mcp.json`, or root-level artifacts.

Also wire:

- `src/install/platforms.ts`: the `install<Target>` function. Copy the root-entry prune options from an installer that already passes them.
- `src/utils/preserved-native-configs.data.ts`: one entry per native config ULIS merges into, with `overlay` (`json`, `toml` or `yaml`), `mcpKey`, `preservedPaths`, and `scope: "global"` if the file exists in only one scope.
- `src/install/preview.ts`: the trust preview must show what the new config will run (commands, URLs, policies), and only for configs active in the install scope.
- `src/install/post-install.ts`: `SKILL_PLATFORM_AGENT_NAMES` takes the skills CLI's agent name, verified in its source. Test both the `"*"` section and an explicit section.
- `src/utils/skill-frontmatter.ts`: `stripKeys` for canonical frontmatter the target rejects or misreads (Hermes drops `model`).

## 4. Audit Schema And Parser Surfaces

Search for hardcoded platform names and explicit unions. At minimum inspect:

- `src/schema/skill.ts`
- `src/schema/extensions.ts`
- `src/schema/permissions.ts`
- `src/schema/mcp.ts`
- `src/parsers/skill.ts`
- `src/parsers/rule.ts`

Questions to answer:

- Does this schema use explicit platform keys that need a new entry?
- Is the new target unsupported on purpose for this config surface, or was it simply omitted?
- If the new platform is not supported here, does the implementation still behave predictably?

## 5. Audit Platform-Specific Helpers

Inspect utility code that switches on platform identity:

- `src/utils/env-var.ts`
- `src/utils/tool-mapper.ts`: map only to tool names the docs list. Decide what an empty result means natively, and warn at build if it means "no tools".
- `src/validators/`: build warnings for anything dropped or written verbatim (`mcp-placeholders.ts` is the pattern)
- any helper used by the new generator

Common miss: adding the platform to `PLATFORMS` but forgetting a utility that still uses a narrower target union.

## 6. Audit Examples And Raw Output

Inspect the reference tree under `example/`.

Usually relevant:

- `example/raw/README.md`
- `example/raw/all/`
- `example/raw/<platform>/`
- `example/skills.yaml`
- `example/extensions.yaml`

Questions to answer:

- Should the example tree include a new `raw/<platform>/` directory?
- Should docs mention the new platform in generated output examples?
- Does the example config need new per-platform keys?

Reminder: `raw/all/` is injected into every generated platform output, while `raw/<platform>/` is target-specific. The legacy `raw/common/` directory is no longer recognized.

## 7. Update Documentation

Check whether these docs need updates:

- `docs/SPEC.md`: capability matrix, adapter section, install targets, and anything the target omits or can't confirm
- `docs/REFERENCE.md`
- `docs/CLI.md`, `docs/index.md`, `docs/guide/getting-started.md`, `docs/guide/project-vs-global.md`
- `README.md` platform list, install table and caveats
- `skills/ulis/SKILL.md` and `skills/ulis/references/`
- `AGENTS.md`: the platform list, blast-radius directories, "Preserve what we did not write" list, "other N adapters" count, and the platform documentation link
- `CONTEXT.md` if the target adds a term
- `CHANGELOG.md` Unreleased, including behavior changes on other platforms
- `package.json` `description`
- `src/scaffold/`: both the `*.template.yaml` file and its inlined twin in `index.ts`
- `src/tools/dev-install.ts`

Important detail from `AGENTS.md`: if you changed Zod schemas, run `bun run gen:reference` so `docs/REFERENCE.md` stays in sync.

## 8. Add Tests

Inspect nearby tests before writing new ones:

- `src/workflow.test.ts` and `src/platforms.test.ts` for canonical ordering and platform parsing
- `src/schema.test.ts` for schema coverage
- `tests/integration.test.ts` and other integration fixtures for end-to-end generation behavior

Focus on tests that reduce regression risk:

- parsing the new platform from CLI target lists
- preserving canonical ordering
- generator output for the new target, including `tests/golden-artifacts.ts` (hand-edited) and `tests/integration.test.ts`
- install behavior in a new `src/install.runinstall-<target>.test.ts`, temp directories only: stale managed entries pruned, unmanaged entries and native config values kept, `--no-prune`, failed copy, both scopes
- every shared install test that iterates `PLATFORMS` (MCP ownership, native config, trust gate). A scope where the target writes no MCP config needs an explicit branch, not a skipped assertion.
- schema acceptance/rejection for new platform keys

A new test must fail without the change it covers. Revert the change once and watch it fail.

## 9. Verification Sequence

Run from the repo root, in this order:

1. `bun run format`
2. `bun run lint`
3. `bun run test`

Also run these when applicable:

4. `bun run build`
5. `node dist/cli.js build --source example`
6. `bun run gen:reference` if Zod schemas changed
7. `bun run gen:screenshot`, then commit `tui.svg` if it changed. The TUI screenshot lists the platforms, and CI fails when it is stale.
8. `bun run format:check`, which is what CI runs

In a stack of PRs, run all of these on every branch, not just the top one.

Then compare the generated `example/` output with the tool's online docs, page by page: keys, enums, separators, limits and paths. Record any mismatch you leave in the PR body.

Do not commit `dist/` or `example/generated/`.

## Common Failure Modes

- Added the target to `PLATFORMS` but not to `src/generators/index.ts` or `src/install.ts`
- Added a generator but forgot parser/schema unions with explicit platform strings
- Treated extensions or permissions as universal even though existing platforms are asymmetric
- Forgot env-var translation or tool-name mapping helpers
- Updated schemas without regenerating reference docs
- Added example output instead of source example config
- Emitted a value that is valid in shape but wrong in meaning (empty tool list, unknown tool name, a dropped `transport: sse`)
- Used the platform id where an external CLI expects its own name
- Forgot `tui.svg`, so CI failed on every branch above the change
- Recorded a merged native config as a managed root entry
- A fix to install code that changed copy semantics for unmanaged content, such as inheriting `namedDirectories` into another pass

## Recommended Working Style

Keep a short audit log while you work:

- required touchpoints you changed
- optional touchpoints you inspected
- features the new platform supports
- features intentionally omitted or downgraded
- verification commands run

That makes the final implementation easier to review and reduces the chance of a half-integrated platform.
