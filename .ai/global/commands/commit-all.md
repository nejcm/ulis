---
description: Stage and commit all changes with a generated message
subtask: true
model: anthropic/claude-haiku-4-5-20251001
platforms:
  opencode:
    model: anthropic/claude-haiku-4-5-20251001
---

Use the context below, then follow the steps.

Working tree:
!`git status --short`

Change summary:
!`git diff --stat`

Recent commits:
!`git log --oneline -10`

**IMPORTANT**: This command stages and commits ALL changes in the working directory. Do not cherry-pick or selectively stage files unless there are sensitive files (credentials, secrets) that should not be committed. Stage everything with `git add .` as instructed.

1.  **Safety Preflight**:
    - Review the **Working tree** section above and ensure no sensitive files are present (e.g., `.env`, credentials, keys).
    - If anything looks sensitive or uncertain, STOP and ask the user how to proceed before staging.

2.  **Stage Changes**:
    - If the **Working tree** section above shows no changes, report and stop (do not create an empty commit).
    - Run `git add .` to stage all modified and untracked files.

3.  **Generate Commit**:
    - Analyze the staged changes (use `git diff --cached` if needed, the context at the start of the document should be enough).
    - Draft a concise, descriptive commit message following **Conventional Commits** (e.g., `feat: add search`, `fix: handle null url`).
    - Create the commit using `git commit -m "..."`.

4.  **Handle Pre-commit Hook Failures**:
    - If hooks fail, report the error output clearly and ask how to proceed.
    - If hooks modify files and the commit fails, re-stage and retry once; otherwise ask for next steps.
    - Report all other errors or unexpected output and ask for next steps.

5.  **Report**:
    - Output the result of the commit operation and final `git status --short`.
    - Don't enumerate steps from this document, avoid saying "Used Conventional Commits" for exmaple.
