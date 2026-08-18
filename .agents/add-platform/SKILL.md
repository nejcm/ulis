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

## Clarify The Target

Confirm the new platform's expected behavior before implementing:

- What files should ULIS generate for this platform?
- Should it install into a project-local directory, a home directory, or both?
- Which existing features map cleanly: agents, skills, rules, MCP, permissions, extensions, raw fragments?
- Which features do **not** map cleanly and need omission or policy-comment behavior?

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

## Output

When using this skill, produce:

1. A short summary of the target's intended capabilities.
2. A checklist of required repo touchpoints you will update.
3. A note about optional touchpoints you inspected and whether each needed changes.
4. The validation commands you ran, and any commands you could not run.

## Reference

Read `references/adding-platform-checklist.md` for the repo-specific file map, optional surfaces, failure modes, and validation sequence.
