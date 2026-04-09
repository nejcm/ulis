/**
 * Valid model identifiers per platform.
 *
 * These are the only values accepted in `platforms.<platform>.model` fields.
 * Add new models here as platforms release them; validation in schema.ts is
 * derived directly from these arrays.
 */

// Claude Code
export const CLAUDE_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

// OpenCode (provider/model-id format)
export const OPENCODE_MODELS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5-20251001",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "opencode/kimi-k2.5-free",
] as const;
export type OpenCodeModel = (typeof OPENCODE_MODELS)[number];

// Codex (OpenAI)
export const CODEX_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
] as const;
export type CodexModel = (typeof CODEX_MODELS)[number];

// Cursor
export const CURSOR_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;
export type CursorModel = (typeof CURSOR_MODELS)[number];

// All known model identifiers across all platforms (no duplicates — CURSOR_MODELS === CLAUDE_MODELS)
export const ALL_MODELS = [...CLAUDE_MODELS, ...OPENCODE_MODELS, ...CODEX_MODELS] as const;
export type AnyModel = (typeof ALL_MODELS)[number];
