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

Add the generator implementation under `src/generators/<target>.ts`, then register it in `src/build.ts`.

Audit:

- generator imports
- `switch (target)` handling
- generator argument shape
- whether the target should receive permissions, rules, plugins, or unsupported-platform settings

Compare against the closest existing generator instead of treating all generators as equivalent. The current build wiring is intentionally asymmetric.

## 3. Add Install Support

Wire the new target into `src/install.ts`.

Audit:

- install `switch (platform)` handling
- merge vs copy behavior
- destination directory logic through `platformConfigDir()`
- global skill installer support in `SKILL_PLATFORM_AGENT_NAMES`
- platform-specific side effects like plugin installation or top-level file placement

Why it matters: some targets install into a single config directory, while others also merge files like `settings.json`, `mcp.json`, or root-level artifacts.

## 4. Audit Schema And Parser Surfaces

Search for hardcoded platform names and explicit unions. At minimum inspect:

- `src/schema/skill.ts`
- `src/schema/plugins.ts`
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
- `src/utils/tool-mapper.ts`
- any helper used by the new generator

Common miss: adding the platform to `PLATFORMS` but forgetting a utility that still uses a narrower target union.

## 6. Audit Examples And Raw Output

Inspect the reference tree under `example/`.

Usually relevant:

- `example/raw/README.md`
- `example/raw/all/`
- `example/raw/<platform>/`
- `example/skills.yaml`
- `example/plugins.yaml`

Questions to answer:

- Should the example tree include a new `raw/<platform>/` directory?
- Should docs mention the new platform in generated output examples?
- Does the example config need new per-platform keys?

Reminder: `raw/all/` is injected into every generated platform output, while `raw/<platform>/` is target-specific. The legacy `raw/common/` directory is no longer recognized.

## 7. Update Documentation

Check whether these docs need updates:

- `docs/SPEC.md`
- `docs/REFERENCE.md`
- `docs/CLI.md`
- any README that lists supported platforms or generated directories

Important detail from `AGENTS.md`: if you changed Zod schemas, run `bun run gen:reference` so `docs/REFERENCE.md` stays in sync.

## 8. Add Tests

Inspect nearby tests before writing new ones:

- `src/workflow.test.ts` for canonical ordering and platform parsing
- `src/schema.test.ts` for schema coverage
- `tests/integration.test.ts` and other integration fixtures for end-to-end generation behavior

Focus on tests that reduce regression risk:

- parsing the new platform from CLI target lists
- preserving canonical ordering
- generator output for the new target
- install behavior if it has merge logic or special paths
- schema acceptance/rejection for new platform keys

## 9. Verification Sequence

Run from the repo root, in this order:

1. `bun run format`
2. `bun run lint`
3. `bun run test`

Also run these when applicable:

4. `bun run build`
5. `node dist/cli.js build --source example`
6. `bun run gen:reference` if Zod schemas changed

Do not commit `dist/` or `example/generated/`.

## Common Failure Modes

- Added the target to `PLATFORMS` but not to `src/build.ts` or `src/install.ts`
- Added a generator but forgot parser/schema unions with explicit platform strings
- Treated plugins or permissions as universal even though existing platforms are asymmetric
- Forgot env-var translation or tool-name mapping helpers
- Updated schemas without regenerating reference docs
- Added example output instead of source example config

## Recommended Working Style

Keep a short audit log while you work:

- required touchpoints you changed
- optional touchpoints you inspected
- features the new platform supports
- features intentionally omitted or downgraded
- verification commands run

That makes the final implementation easier to review and reduces the chance of a half-integrated platform.
