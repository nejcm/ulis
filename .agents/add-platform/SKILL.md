---
name: add-platform
description: Checklist for adding a new ULIS platform target or adapter. Use this whenever the user wants to add support for a new tool, register a new build target, add a new generator/install path, extend `PLATFORMS`, wire a new platform through build or install, or asks how to add another Claude/Cursor/Codex-style output to this repository.
category: workflow
---

# Add Platform Target

Use this skill when the task is to add a **new ULIS platform target** to the repository, not just to tweak an existing platform's generated output.

This skill is intentionally a checklist, not a scaffolder. Its job is to keep the implementation complete and ordered so platform work does not miss one of the repo's scattered touchpoints.

## Start Here

Before proposing or editing code:

1. Read `AGENTS.md` for repo-wide expectations and required verification commands.
2. Read `src/platforms.ts` to understand the canonical platform IDs, labels, ordering, and install directories.
3. Read `docs/SPEC.md`, especially the "Extending ULIS - Adding a New Adapter" section.
4. Read the generator closest to the new target so you can copy an existing capability pattern instead of inventing one.
5. Read `references/adding-platform-checklist.md` from this skill and work through it top to bottom.

## Research Before Code

Every mapping decision must trace to the tool's official docs, or be listed as unverified. Write a short capability table first: one row per ULIS feature, with the native path, the native format, and the doc URL that proves it.

- Read the docs pages themselves, not summaries. Some doc sites only return useful text with `curl -L --compressed`.
- Confirm the runtime meaning of every value you emit, not only its shape. An Antigravity subagent with `tools: []` has **no** tools, and an unknown tool name can hang it.
- Confirm global and project paths separately, including legacy fallbacks (Antigravity reads `~/.gemini/config/skills/`, and `~/.gemini/antigravity/skills/` only as legacy).
- Check whether the tool interpolates `${VAR}` itself. If it does, write placeholders verbatim; if not, warn at build.
- Check who owns each native config file. If the tool rewrites it (Hermes `hermes config set`), ULIS may only overlay its own keys.
- Look up the external skills CLI's agent name in `vercel-labs/skills` `src/agents.ts`. It often differs from the platform id (`hermes-agent`, not `hermes`).
- Anything you cannot confirm goes in the PR body under "Not verified", not into the code as fact.

"No target" is a valid outcome. Zed got docs only: its skills and instructions are already reached by other targets, and its MCP config lives in a user-edited JSONC `settings.json`. Record the reasoning in `docs/SPEC.md` and `README.md`.

## Clarify The Target

Confirm the new platform's expected behavior before implementing:

- What files should ULIS generate for this platform?
- Should it install into a project-local directory, a home directory, or both? Can a native config be written in both scopes, or only one (Hermes `config.yaml` is global-only)?
- Which existing features map cleanly: agents, skills, rules, MCP, permissions, extensions, raw fragments?
- Which features do **not** map cleanly and need omission or policy-comment behavior?
- Does the destination directory overlap another tool's (Antigravity's `.agents/skills/` is also read by Zed and the skills CLI)?

If those answers are unclear, ask first. The repo already supports asymmetric platforms, so "not supported" is a valid answer as long as it is handled deliberately.

## Ordered Implementation Flow

Work in this order so the platform is defined once and then wired through the system:

1. Extend the platform registry in `src/platforms.ts`.
2. Add the generator module in `src/generators/platforms/<target>/`.
3. Register the generator in the `GENERATORS` map in `src/generators/index.ts`.
4. Register installation behavior in `src/install.ts`.
5. Audit schema and parser surfaces that hardcode platform keys or unions.
6. Audit helper utilities that switch on platform names.
7. Update docs, reference examples, and any raw platform directories that should exist.
8. Add or update tests.
9. Run the repo verification sequence.
10. Verify the finished implementation against the tool's online docs (see below).

## Things That Are Easy To Miss

Do not stop after `src/platforms.ts` and a new generator. Check whether the new target also needs updates in:

- `src/schema/*.ts` files with explicit platform keys
- `src/parsers/skill.ts` and `src/parsers/rule.ts` unions
- `src/schema/mcp.ts` target usage
- `src/utils/env-var.ts`
- `src/utils/tool-mapper.ts`
- `example/raw/`
- `example/skills.yaml`, `example/extensions.yaml`, and permissions config shapes
- tests under `src/*.test.ts` and `tests/`

Missing one of those is the most common reason a new platform is only half-integrated.

## Capability Mismatches

Prefer explicit handling over pretending two platforms are identical.

- If the platform cannot express a field, look for an existing omission/comment pattern rather than forcing a fake mapping.
- Use the same reasoning as the existing generators: preserve canonical source data, then emit the closest faithful platform representation.
- When the spec already documents a fallback, follow it instead of inventing a new one.
- A comment in the generated file is not enough when the output changes behavior (a dropped tool, an omitted MCP reference). Add a build warning through a validator in `src/validators/`, as `mcp-placeholders.ts` does.
- If the native shape of a field is undocumented, omit it and warn. Let users pass the native form through `platforms.<target>.<field>`, as Antigravity agent `mcpServers` does.

## Install Safety

`ulis install` deletes files. Treat every install change as data-loss-sensitive:

- Every file the install writes must be recorded in the ownership manifest; never add a write path that skips it.
- Native configs ULIS merges into (`settings.json`, `config.toml`, `mcp_config.json`, `config.yaml`) are never root entries. They are protected by `PLATFORM_INSTALL_SKIP_NAMES` and excluded in `listManagedRootFiles`.
- Wire root-entry pruning the same way on every installer: `pruneExtraNames`, `previouslyManagedRootEntries` and `currentManagedRootEntries` passed to `copyPlatformContents`. The sweep runs after a successful copy; before the copy it only clears entries that block it.
- A platform installed in two passes (ForgeCode) defers the sweep until both passes succeed, and must not inherit the other pass's `namedDirectories`.
- A file re-serialised from YAML loses its comments. Leave an unchanged file byte-identical, and warn when comments are dropped.
- Same-name agents or skills the previous manifest does not record are replaced with a warning on every platform. Keep that policy; don't add per-platform refusals.
- Tests go in temp directories only, and must prove: unmanaged files survive, a failed copy deletes nothing that wasn't blocking it, `--no-prune` keeps stale entries, and preserved native config values survive (assert the values, not just that the file exists).

## Verify Against The Docs

Before opening the PR, re-read each doc page cited in the capability table and compare it with the generated output, not with your notes. Build `example/` and check every emitted file against the docs:

- each key, value and enum is one the docs list, with the documented type and separator (Antigravity `globs` is `"*.ts, *.tsx"`)
- each documented key ULIS can fill is emitted, or its omission is in `docs/SPEC.md` (Hermes `transport: sse` was once dropped)
- documented limits (file size, token budgets) are enforced or warned at build
- install paths match the documented global and project locations

Fix every mismatch, or record it under "Not verified" in the PR body with the doc URL. Docs change; a mapping verified at research time may be stale at review time.

## Output

When using this skill, produce:

1. A short summary of the target's intended capabilities, with the doc URL behind each mapping.
2. A checklist of required repo touchpoints you will update.
3. A note about optional touchpoints you inspected and whether each needed changes.
4. The validation commands you ran, and any commands you could not run.
5. What was not verified against the real tool, which also goes in the PR body.

Get an independent review from another model family before opening the PR. When a fix round touches install code, ask the reviewer to compare every `copyPlatformContents` option per pass against the base commit, not just the latest diff; regressions in this session came from fixes, one at a time.

## Reference

Read `references/adding-platform-checklist.md` for the repo-specific file map, optional surfaces, failure modes, and validation sequence.
