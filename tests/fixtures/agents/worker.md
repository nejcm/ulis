---
description: A minimal test agent
model: haiku
tools:
  read: true
  edit: true
tags:
  - core
contextHints:
  maxInputTokens: 20000
  priority: high
toolPolicy:
  avoid:
    - Bash
  requireConfirmation:
    - Write
security:
  permissionLevel: readonly
  blockedCommands:
    - rm -rf
  rateLimit:
    perHour: 30
---

You are a minimal worker agent used in tests.
