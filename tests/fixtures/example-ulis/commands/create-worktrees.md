---
description: Create worktrees for all open PR branches
subtask: true
model: haiku
platforms:
  opencode:
    model: haiku
---

Create git worktrees for every open GitHub PR branch in `./tree/<branch>`.

Repository state:
!`git status --short`

Current worktrees:
!`git worktree list`

Follow these steps:

1. **Preflight checks**:
   - Ensure the current directory is inside a git repository (`git rev-parse --is-inside-work-tree`).
   - Ensure GitHub CLI is installed and authenticated (`gh auth status`).
   - If either check fails, stop and report the exact issue.

2. **Prepare workspace**:
   - Resolve repo root (`git rev-parse --show-toplevel`).
   - Create `<repo>/tree` if missing.

3. **Enumerate open PR branches**:
   - Get branch names with `gh pr list --json headRefName --jq '.[].headRefName'`.
   - If no open PR branches are returned, report and stop.

4. **Create missing worktrees**:
   - For each branch, target path is `<repo>/tree/<branch>`.
   - Create parent directories for branch names that include slashes.
   - If the target path already exists, report it as skipped.
   - If a local branch exists, run `git worktree add "<path>" "<branch>"`.
   - If the local branch does not exist, fetch and create from `origin/<branch>` using `git worktree add -b "<branch>" "<path>" "origin/<branch>"`.
   - If a branch cannot be added, continue with the rest and report the failure.

5. **Report**:
   - Show created, skipped, and failed branches.
   - Show final `git worktree list`.

Do not remove any existing worktrees in this command.
