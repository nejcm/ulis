/**
 * Known model identifiers per platform.
 *
 * Model schemas keep these values as suggestions but also accept arbitrary
 * strings because provider model catalogs change frequently.
 */

// Claude Code
export const CLAUDE_MODELS = [
  "default",
  "best",
  "opus",
  "opus[1m]",
  "opusplan",
  "sonnet",
  "sonnet[1m]",
  "haiku",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-opus-4-5-20251101",
  "claude-opus-4-1-20250805",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
  "claude-3-7-sonnet-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-3-5-haiku-20241022",
  "claude-3-5-haiku-latest",
] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

// OpenCode (provider/model-id format)
export const OPENCODE_MODELS = [
  "anthropic/opus",
  "anthropic/sonnet",
  "anthropic/claude-opus-4-7",
  "anthropic/claude-opus-4-6",
  "anthropic/claude-opus-4-5",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-sonnet-4-5-20250929",
  "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-haiku-4-5",
  "anthropic/claude-haiku-4-5-20251001",
  "openai/gpt-5.5",
  "openai/gpt-5.5-2026-04-23",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.2-codex",
  "openai/gpt-5.2",
  "openai/gpt-5.3-chat-latest",
  "opencode/gpt-5.1-codex",
  "opencode/kimi-k2.5-free",
] as const;
export type OpenCodeModel = (typeof OPENCODE_MODELS)[number];

// Codex (OpenAI)
export const CODEX_MODELS = [
  "gpt-5.5",
  "gpt-5.5-2026-04-23",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.3-chat-latest",
] as const;
export type CodexModel = (typeof CODEX_MODELS)[number];

// Cursor
export const CURSOR_MODELS = [
  "auto",
  "composer-2",
  "opus",
  "sonnet",
  "haiku",
  "claude-opus-4.7",
  "claude-opus-4-7",
  "opus-4.7",
  "opus-4.7-thinking",
  "claude-sonnet-4.6",
  "claude-sonnet-4-6",
  "sonnet-4.6",
  "sonnet-4.6-thinking",
  "claude-haiku-4.5",
  "claude-haiku-4-5",
  "haiku-4.5",
  "sonnet-4.5",
  "sonnet-4.5-thinking",
  "claude-haiku-4-5-20251001",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5",
  "gpt-5-codex",
] as const;
export type CursorModel = (typeof CURSOR_MODELS)[number];

// All known model identifiers across all platforms.
export const ALL_MODELS = [...CLAUDE_MODELS, ...OPENCODE_MODELS, ...CODEX_MODELS, ...CURSOR_MODELS] as const;
export type AnyModel = (typeof ALL_MODELS)[number];
