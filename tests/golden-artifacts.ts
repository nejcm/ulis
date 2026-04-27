export const GOLDEN_ARTIFACTS = {
  claude: {
    "agents/worker.md": `---
name: worker
description: A minimal test agent
model: claude-haiku-4-5-20251001
tools: "Read, Glob, Grep, Edit"
disallowedTools: Bash
permissionMode: plan
hooks:
  PreToolUse:
    - matcher: "Bash(rm -rf*)"
      hooks:
        - type: command
          command: "echo \\"Blocked by ULIS security policy: rm -rf\\" && exit 1"
---

<!--
  [ULIS contextHints]
    maxInputTokens: 20000
    priority: high
-->

<!--
  [ULIS toolPolicy]
    avoid: Bash
    requireConfirmation: Write
-->

<!--
  [ULIS security]
    permissionLevel: readonly
    blockedCommands: rm -rf
    rateLimit: 30/hour
-->

You are a minimal worker agent used for testing.
`,
  },
  opencode: {
    "opencode.json": `{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/sonnet",
  "small_model": "opencode/kimi-k2.5-free",
  "agent": {
    "worker": {
      "description": "A minimal test agent",
      "mode": "subagent",
      "model": "claude-haiku-4-5-20251001",
      "tools": {
        "read": true,
        "write": false,
        "edit": true,
        "bash": false,
        "search": false,
        "browser": false
      },
      "permission": {
        "edit": "deny",
        "bash": "deny"
      },
      "rate_limit_per_hour": 30
    }
  },
  "permission": {},
  "mcp": {
    "test-local": {
      "type": "local",
      "enabled": true,
      "command": [
        "node",
        "./mcp-server.js"
      ],
      "environment": {
        "API_KEY": "\${TEST_API_KEY}"
      }
    },
    "test-remote": {
      "type": "remote",
      "enabled": true,
      "url": "https://mcp.example.com/sse",
      "headers": {
        "Authorization": "Bearer {env:TEST_REMOTE_TOKEN}"
      }
    }
  }
}
`,
  },
  codex: {
    "config.toml": `model = "gpt-5.4"
model_reasoning_effort = "high"

[windows]
sandbox = "elevated"

[mcp_servers.test-local]
command = "node"
args = ["./mcp-server.js"]
startup_timeout_sec = 20

[mcp_servers.test-local.env]
API_KEY = "\${TEST_API_KEY}"

[mcp_servers.test-remote]
url = "https://mcp.example.com/sse"
bearer_token_env_var = "TEST_REMOTE_TOKEN"
startup_timeout_sec = 20
`,
  },
  cursor: {
    "agents/worker.mdc": `---
description: A minimal test agent
model: claude-haiku-4-5-20251001
readonly: true
tools:
  - read_file
  - list_directory
  - search_files
  - edit_file
---

<!--
  [ULIS contextHints]
    maxInputTokens: 20000
    priority: high
-->

<!--
  [ULIS toolPolicy]
    avoid: Bash
    requireConfirmation: Write
-->

<!--
  [ULIS security]
    permissionLevel: readonly
    blockedCommands: rm -rf
    rateLimit: 30/hour
-->

You are a minimal worker agent used for testing.
`,
  },
  forgecode: {
    ".forge/agents/worker.md": `---
id: worker
title: worker
description: A minimal test agent
model: claude-haiku-4-5-20251001
tools:
  - read
  - patch
---

<!--
  [ULIS contextHints]
    maxInputTokens: 20000
    priority: high
-->

<!--
  [ULIS toolPolicy]
    avoid: Bash
    requireConfirmation: Write
-->

<!--
  [ULIS security]
    permissionLevel: readonly
    blockedCommands: rm -rf
    rateLimit: 30/hour
-->

You are a minimal worker agent used for testing.
`,
  },
} as const;
