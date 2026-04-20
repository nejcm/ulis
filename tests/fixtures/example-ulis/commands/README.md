# Commands

OpenCode slash commands — executable workflows that run directly inside OpenCode sessions. Commands are copied as-is to the generated OpenCode config.

## File Format

Each command is a Markdown file with YAML frontmatter:

```markdown
---
description: "What this command does"
---

[Step-by-step instructions for the command]
```

Invoke in OpenCode with `/command-name`.

## How It's Used

The build system copies `commands/` directly into `generated/opencode/commands/` at the repo root. No transformation is applied — the files are used as-is by OpenCode.

## Adding a New Command

1. Create `.ai/global/commands/<name>.md` with a `description` in the frontmatter
2. Write the step-by-step instructions in the body
3. Run `bun run build` from the repo root — the command will be included automatically
4. Invoke it in OpenCode with `/<name>`
