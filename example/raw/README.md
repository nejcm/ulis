# Raw

Platform-specific source fragments that are injected verbatim into generated configs during the build. Unlike `agents/`, `commands/`, and `skills/` (which are transformed), files here bypass transformation and land directly in the target platform's output.

## Directory Structure

```
raw/
├── common/     # Injected into every platform's generated output
├── claude/     # Claude Code-specific injections
├── codex/      # Codex-specific injections
├── cursor/     # Cursor-specific injections
├── opencode/   # OpenCode-specific injections
└── forgecode/  # ForgeCode-specific injections
```

## How It's Used

During `bun run build`, the build system reads each subdirectory and copies its contents into the corresponding platform's generated output directory:

| Source dir       | Destination            |
| ---------------- | ---------------------- |
| `raw/common/`    | All platform outputs   |
| `raw/claude/`    | `generated/claude/`    |
| `raw/codex/`     | `generated/codex/`     |
| `raw/cursor/`    | `generated/cursor/`    |
| `raw/opencode/`  | `generated/opencode/`  |
| `raw/forgecode/` | `generated/forgecode/` |

Files in `raw/common/` are copied to **every** platform's generated directory.

## Current Files

### `common/AGENTS.md`

Cross-platform agent instructions injected into every tool's config. Contains:

- **Communication style** — be concise, no filler phrases, no unsolicited summaries
- **Honesty policy** — never lie, never omit, ask for clarification when unsure
- **Efficiency rules** — minimize tokens, search before reading, use quiet flags, show diffs not full files
- **Coding rule** — always apply the `coding-principles` skill before writing, reviewing, or refactoring code

## When to Use `raw/` vs Other Directories

| Use case                                              | Where to put it   |
| ----------------------------------------------------- | ----------------- |
| New agent with cross-platform support                 | `agents/`         |
| New OpenCode slash command                            | `commands/`       |
| New reusable skill                                    | `skills/`         |
| Platform-specific config block with no transformation | `raw/<platform>/` |
| Shared instruction text injected into all platforms   | `raw/common/`     |

## Adding a Raw Fragment

1. Create the file in the appropriate subdirectory (`raw/common/`, `raw/claude/`, etc.)
2. Run `bun run build` — the file will be copied into the generated output
3. Run `bun run install:configs` to deploy
