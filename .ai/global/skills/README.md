# Skills

OpenCode skill definitions — reusable, invocable capabilities that agents can call during a session. Each skill lives in its own subdirectory with a `SKILL.md` and optional `config/` or `references/` directories.

## Structure

```
skills/
  <skill-name>/
    SKILL.md          # Skill definition and instructions
    config/           # Tool configs used by the skill (optional)
    references/       # Reference documents the skill uses (optional)
```

## How It's Used

The build system copies `skills/` directly into `generated/[PLATFORM]/skills/` at the repo root. No transformation is applied — files are used as-is by OpenCode.

## Adding a New Skill

1. Create `.ai/global/skills/<name>/SKILL.md` with the skill instructions
2. Add a `config/` directory if the skill uses tool-specific configuration files
3. Add a `references/` directory for any reference documents the skill reads
4. Run `bun run build` from the repo root — the skill will be included automatically
5. Invoke it in OpenCode with the skill name
