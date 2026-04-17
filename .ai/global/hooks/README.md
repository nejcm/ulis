# Hooks

Event-driven automation scripts that execute automatically in response to agent lifecycle events. Hooks allow you to enforce policies, run side effects, and integrate external systems without modifying agent prompts.

## File Format

Each hook is a Markdown file with YAML frontmatter:

```markdown
---
description: "What this hook does"
event: PreToolUse | PostToolUse | Stop
match:
  tool: "*" | "Bash" | "Edit" | ...
  pattern: "optional glob/regex to match tool arguments"
---

[Instructions the agent follows when this hook fires]
```

### Events

| Event         | Fires                            | Common uses                                      |
| ------------- | -------------------------------- | ------------------------------------------------ |
| `PreToolUse`  | Before a tool call executes      | Validation, blocking dangerous commands, logging |
| `PostToolUse` | After a tool call completes      | Auto-formatting, follow-up checks, metrics       |
| `Stop`        | When the agent finishes its turn | Final verification, summaries, notifications     |

### `match` Fields

- `tool` — tool name to match (`"*"` for all tools, `"Bash"` for shell commands only)
- `pattern` — optional glob or regex applied to the tool's primary argument (e.g., the command string for Bash, the file path for Edit)

## How It's Used

The build system copies `hooks/` into the generated platform configs. Hook support varies by platform:

| Platform    | Support       |
| ----------- | ------------- |
| Claude Code | Full          |
| OpenCode    | Full          |
| Codex       | Limited       |
| Cursor      | Not supported |

## Adding a New Hook

1. Create `.ai/global/hooks/<name>.md` with frontmatter and instructions
2. Set `event` and optionally scope it with `match`
3. Run `bun run build` → `bun run install:configs`

## Example Hooks

### Block destructive git commands (PreToolUse)

```markdown
---
description: "Block force-push and hard reset"
event: PreToolUse
match:
  tool: Bash
  pattern: "git push --force*|git reset --hard*"
---

Refuse to execute this command. Explain why it is dangerous and suggest a safer alternative.
```

### Auto-lint after file edits (PostToolUse)

```markdown
---
description: "Run linter on edited TypeScript files"
event: PostToolUse
match:
  tool: Edit
  pattern: "*.ts|*.tsx"
---

Run `bun run lint:file:<edited-file>` and report any lint errors found.
```

### Session summary on stop (Stop)

```markdown
---
description: "Print a concise summary when the session ends"
event: Stop
---

Output a 3-bullet summary of what changed this session: files modified, commands run, and any issues found.
```
