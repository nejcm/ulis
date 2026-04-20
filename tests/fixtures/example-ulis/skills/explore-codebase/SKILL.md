---
name: explore-codebase
description: Systematic codebase exploration methodology
category: workflow
model: sonnet
platforms:
  codex:
    model: gpt-5.4
---

## When exploring unfamiliar code

1. Start with package.json/composer.json to understand dependencies
2. Read AGENTS.md or README for project overview
3. Identify entry points (main, index, server files)
4. Trace request flow from entry to database
5. Note patterns: DI, repository, service layers
6. Document in a summary for future reference

## Questions to answer

- What framework(s)?
- What database(s)?
- How is auth handled?
- How are tests structured?
- What's the deployment target?
