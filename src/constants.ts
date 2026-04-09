/**
 * Shared constant value arrays used for schema validation and type inference.
 *
 * Follow the same pattern as models.ts: export a `const` array and derive a
 * union type from it so both runtime validation and TypeScript types stay in sync.
 */

// Effort levels (agent / skill reasoning budget)
export const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

// Isolation modes
export const AGENT_ISOLATION_MODES = ["worktree", "none"] as const;
export type AgentIsolationMode = (typeof AGENT_ISOLATION_MODES)[number];

export const SKILL_ISOLATION_MODES = ["fork", "none"] as const;
export type SkillIsolationMode = (typeof SKILL_ISOLATION_MODES)[number];

// Memory scopes
export const MEMORY_SCOPES = ["user", "project", "local", "none"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

// UI colors
export const AGENT_COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"] as const;
export type AgentColor = (typeof AGENT_COLORS)[number];

// Context window priority
export const CONTEXT_PRIORITIES = ["low", "normal", "high"] as const;
export type ContextPriority = (typeof CONTEXT_PRIORITIES)[number];

// Security permission levels
export const PERMISSION_LEVELS = ["readonly", "readwrite", "full"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

// Tool categories that can require approval
export const APPROVAL_ACTIONS = ["write", "edit", "bash", "agent", "mcp"] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

// Claude Code permission modes
export const CLAUDE_PERMISSION_MODES = ["default", "auto", "acceptEdits", "dontAsk", "bypassPermissions", "plan"] as const;
export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

// OpenCode agent execution modes
export const OPENCODE_AGENT_MODES = ["primary", "subagent", "all"] as const;
export type OpenCodeAgentMode = (typeof OPENCODE_AGENT_MODES)[number];

// OpenCode permission actions (per tool category)
export const OPENCODE_PERMISSION_ACTIONS = ["ask", "allow", "deny"] as const;
export type OpenCodePermissionAction = (typeof OPENCODE_PERMISSION_ACTIONS)[number];

// Shell types (used in skill Claude platform override)
export const SHELL_TYPES = ["bash", "powershell"] as const;
export type ShellType = (typeof SHELL_TYPES)[number];
