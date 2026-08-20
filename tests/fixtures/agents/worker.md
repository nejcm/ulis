---
description: "A minimal test agent, focus: safe changes"
model: claude-haiku-4-5-20251001
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

You are a minimal worker agent used for testing.
