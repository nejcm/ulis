---
description: Remove stale worktrees for deleted branches
subtask: true
model: anthropic/claude-haiku-4-5-20251001
platforms:
  opencode:
    model: anthropic/claude-haiku-4-5-20251001
---

Remove stale worktrees under `./tree` when their branches no longer exist.

Current worktrees:
!`git worktree list`

Follow these steps:

1. **Preflight checks**:
   - Ensure the current directory is inside a git repository (`git rev-parse --is-inside-work-tree`).
   - Resolve repo root with `git rev-parse --show-toplevel`.
   - If either fails, stop and report the exact issue.

2. **Gather branch and worktree state**:
   - Refresh remote refs with `git fetch --all --prune`.
   - Collect valid branch names from local and remote refs.
   - Collect worktrees using `git worktree list --porcelain`.

3. **Identify stale worktrees**:
   - Only consider linked worktrees under `<repo>/tree/`.
   - Ignore the main worktree.
   - For each candidate worktree, read its associated branch from porcelain output (`branch refs/heads/...`).
   - Mark as stale when that branch no longer exists locally and no matching `origin/<branch>` exists.

4. **Remove stale worktrees**:
   - For each stale worktree, run `git worktree remove --force "<path>"`.
   - Continue on errors and report failures.

5. **Report**:
   - Show removed, skipped, and failed paths.
   - Show final `git worktree list`.

Do not remove worktrees outside `<repo>/tree/`.
