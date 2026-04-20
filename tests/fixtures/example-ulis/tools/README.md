# Tools

Shared utility scripts used by the build system and development workflow. Unlike `skills/` (which are invoked by agents at runtime), tools here are called during the build and install process.

## Structure

```
tools/
  <tool-name>/         # One directory per tool (optional — simple scripts can be top-level files)
    index.ts | index.js
    README.md          # (optional) if the tool needs its own docs
```

## When to Add a Tool Here

- Build-time helpers (e.g., a script that validates agent frontmatter)
- Install helpers (e.g., a script that merges generated configs into platform locations)
- Shared utilities called from `package.json` scripts
- One-off automation scripts that support the `.ai/global` workflow

Do **not** put runtime agent skills here — those belong in `skills/`.

## Adding a New Tool

1. Create the script under `.ai/global/tools/`
2. Wire it up in the repo's `package.json` scripts if needed
3. Run `bun run build` if the tool affects the build output
