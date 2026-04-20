---
description: Create a branch and matching worktree
subtask: true
model: haiku
platforms:
  opencode:
    model: haiku
---

Create a new branch worktree at `./tree/<branch>`.

Input: `$ARGUMENTS`

Argument format:

- `branch-name`
- `branch-name base-ref`

Follow these steps:

1. **Preflight checks**:
   - Ensure the current directory is inside a git repository (`git rev-parse --is-inside-work-tree`).
   - If not in a repo, stop and report the issue.

2. **Resolve branch and base**:
   - Parse `$ARGUMENTS` as `branch_name` and optional `base_ref`.
   - If no branch name is provided, ask once for a branch name.
   - Default `base_ref` to `HEAD` when not provided.
   - Validate branch name with `git check-ref-format --branch`.

3. **Prepare target path**:
   - Get repo root with `git rev-parse --show-toplevel`.
   - Set `branch_path` to `<repo>/tree/<branch_name>`.
   - Create parent directories when branch names include slashes.
   - If `branch_path` already exists, stop and report the conflict.

4. **Create worktree**:
   - If local branch exists, run `git worktree add "<branch_path>" "<branch_name>"`.
   - If local branch does not exist, run `git worktree add -b "<branch_name>" "<branch_path>" "<base_ref>"`.
   - If creation fails, report the exact error.

5. **Report**:
   - Output the created path.
   - Output `git worktree list`.
   - Output a ready-to-run command: `cd "<branch_path>"`.
