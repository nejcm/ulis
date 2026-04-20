---
description: Detect and run formatting then linting commands
subtask: true
model: haiku
platforms:
  opencode:
    model: haiku
---

Run the following steps to format and lint the code:

1.  **Detect Available Code Quality Tools**:
    - Examine the current project to identify available formatting and linting commands:
      - Check for `package.json`, `Makefile`, `pyproject.toml`, `Cargo.toml`, or other project configuration files
      - Look for common script names like `format`, `lint`, `check`, or similar
      - Identify the appropriate command runner (npm, bun, pnpm, make, cargo, poetry, etc.)
    - If no code quality tools are found, report that none were detected and stop.

2.  **Run Code Quality Tools**:
    - Execute the detected formatting command first (if available).
    - Then execute the detected linting command (if available).
    - If any command fails, stop immediately and report the issues.
    - If no commands are configured, skip this step gracefully.

3.  **Report**:
    - Output which tools were run (or that none were found).
