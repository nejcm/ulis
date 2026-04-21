/**
 * Integration snapshot tests.
 * Runs the full generator pipeline against the minimal fixture set and
 * asserts the output of each generator contains expected content.
 *
 * These are NOT snapshot files in the bun sense — we check for key substrings
 * so the tests survive minor formatting changes while catching regressions
 * in generator logic.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { BUILD_CONFIG } from "../src/config.js";
import { generateClaude } from "../src/generators/claude.js";
import { generateCodex } from "../src/generators/codex.js";
import { generateCursor } from "../src/generators/cursor.js";
import { generateForgecode } from "../src/generators/forgecode.js";
import { generateOpencode } from "../src/generators/opencode.js";
import { parseAgents } from "../src/parsers/agent.js";
import { parseSkills } from "../src/parsers/skill.js";
import { McpConfigSchema, PluginsConfigSchema } from "../src/schema.js";
import { readFile } from "../src/utils/fs.js";
import { validateCollisions } from "../src/validators/collisions.js";
import { validateCrossRefs } from "../src/validators/cross-refs.js";

const fixturesDir = resolve(join(import.meta.dirname, "fixtures"));
const outDir = resolve(join(import.meta.dirname, ".tmp-test-output"));

function readOut(platform: string, ...parts: string[]): string {
  return readFileSync(join(outDir, platform, ...parts), "utf8");
}

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });

  const agents = parseAgents(join(fixturesDir, "agents"));
  const skills = parseSkills(join(fixturesDir, "skills"));
  const mcp = McpConfigSchema.parse(JSON.parse(readFile(join(fixturesDir, "mcp.json"))));
  const plugins = PluginsConfigSchema.parse(JSON.parse(readFile(join(fixturesDir, "plugins.json"))));

  generateClaude(agents, skills, mcp, plugins, fixturesDir, join(outDir, "claude"), BUILD_CONFIG);
  generateOpencode(agents, skills, mcp, fixturesDir, join(outDir, "opencode"), BUILD_CONFIG);
  generateCodex(agents, skills, mcp, fixturesDir, join(outDir, "codex"), BUILD_CONFIG);
  generateCursor(agents, skills, mcp, fixturesDir, join(outDir, "cursor"), BUILD_CONFIG);
  generateForgecode(agents, skills, mcp, fixturesDir, join(outDir, "forgecode"), BUILD_CONFIG);
});

afterAll(() => {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
});

// ─── Claude ──────────────────────────────────────────────────────────────────

describe("Claude generator", () => {
  it("generates agent .md with correct frontmatter", () => {
    const content = readOut("claude", "agents", "worker.md");
    expect(content).toContain("name: worker");
    expect(content).toContain("description: A minimal test agent");
    expect(content).toContain("model: claude-haiku-4-5-20251001");
  });

  it("applies readonly security as permissionMode: plan", () => {
    const content = readOut("claude", "agents", "worker.md");
    expect(content).toContain("permissionMode: plan");
  });

  it("adds toolPolicy.avoid to disallowedTools", () => {
    const content = readOut("claude", "agents", "worker.md");
    expect(content).toContain("disallowedTools:");
    expect(content).toContain("Bash");
  });

  it("synthesizes PreToolUse hook for blockedCommands", () => {
    const content = readOut("claude", "agents", "worker.md");
    expect(content).toContain("hooks:");
    expect(content).toContain("PreToolUse:");
    expect(content).toContain("Bash(rm -rf*)");
  });

  it("embeds contextHints + toolPolicy as HTML comment in body", () => {
    const content = readOut("claude", "agents", "worker.md");
    expect(content).toContain("<!--");
    expect(content).toContain("[ULIS contextHints]");
    expect(content).toContain("maxInputTokens: 20000");
    expect(content).toContain("[ULIS toolPolicy]");
  });

  it("generates settings.json", () => {
    const settings = JSON.parse(readOut("claude", "settings.json"));
    expect(settings).toHaveProperty("mcpServers");
    expect(settings.mcpServers["test-local"]).toBeDefined();
    expect(settings.mcpServers["test-remote"]).toBeDefined();
  });
});

// ─── OpenCode ────────────────────────────────────────────────────────────────

describe("OpenCode generator", () => {
  it("generates opencode.json with agent block", () => {
    const oc = JSON.parse(readOut("opencode", "opencode.json"));
    expect(oc.agent).toHaveProperty("worker");
    expect(oc.agent.worker.model).toBeDefined();
  });

  it("maps readonly security to deny permissions", () => {
    const oc = JSON.parse(readOut("opencode", "opencode.json"));
    const perm = oc.agent.worker.permission;
    expect(perm?.edit).toBe("deny");
    expect(perm?.bash).toBe("deny");
  });

  it("emits rate_limit_per_hour from security.rateLimit", () => {
    const oc = JSON.parse(readOut("opencode", "opencode.json"));
    expect(oc.agent.worker.rate_limit_per_hour).toBe(30);
  });

  it("includes MCP servers for opencode target", () => {
    const oc = JSON.parse(readOut("opencode", "opencode.json"));
    expect(oc.mcp).toHaveProperty("test-local");
    expect(oc.mcp).toHaveProperty("test-remote");
  });
});

// ─── Codex ───────────────────────────────────────────────────────────────────

describe("Codex generator", () => {
  it("generates config.toml", () => {
    const toml = readOut("codex", "config.toml");
    expect(toml).toContain("[mcp_servers.test-local]");
  });

  it("generates agent TOML with policy comments", () => {
    const toml = readOut("codex", "agents", "worker.toml");
    expect(toml).toContain('name = "worker"');
    expect(toml).toContain("# [ULIS contextHints]");
    expect(toml).toContain("#   maxInputTokens: 20000");
    expect(toml).toContain("# [ULIS toolPolicy]");
    expect(toml).toContain("# [ULIS security]");
    expect(toml).toContain("#   permissionLevel: readonly");
  });

  it("uses localFallback for remote MCP servers", () => {
    const toml = readOut("codex", "config.toml");
    // test-remote has a localFallback — should appear in config
    expect(toml).toContain("test-remote");
  });
});

// ─── Cursor ──────────────────────────────────────────────────────────────────

describe("Cursor generator", () => {
  it("generates agent .mdc with model", () => {
    const mdc = readOut("cursor", "agents", "worker.mdc");
    expect(mdc).toContain("description: A minimal test agent");
    expect(mdc).toContain("model:");
  });

  it("embeds policy as HTML comment in mdc body", () => {
    const mdc = readOut("cursor", "agents", "worker.mdc");
    expect(mdc).toContain("<!--");
    expect(mdc).toContain("[ULIS contextHints]");
  });

  it("generates mcp.json with all targeted servers", () => {
    const mcp = JSON.parse(readOut("cursor", "mcp.json"));
    expect(mcp.mcpServers).toHaveProperty("test-local");
    expect(mcp.mcpServers).toHaveProperty("test-remote");
  });
});

// ─── ForgeCode ───────────────────────────────────────────────────────────────

describe("ForgeCode generator", () => {
  it("generates agent markdown with Forge frontmatter", () => {
    const content = readOut("forgecode", ".forge", "agents", "worker.md");
    expect(content).toContain("id: worker");
    expect(content).toContain("description: A minimal test agent");
    expect(content).toContain("tools:");
  });

  it("generates .mcp.json with all targeted servers", () => {
    const mcp = JSON.parse(readOut("forgecode", ".mcp.json"));
    expect(mcp.mcpServers).toHaveProperty("test-local");
    expect(mcp.mcpServers).toHaveProperty("test-remote");
  });

  it("copies skill directories under .forge/skills", () => {
    const content = readOut("forgecode", ".forge", "skills", "my-skill", "SKILL.md");
    expect(content).toContain("A minimal test skill");
  });

  it("copies raw/common and raw/forgecode payloads", () => {
    expect(readOut("forgecode", "AGENTS.md")).toContain("fixture common guidance");
  });
});

// ─── Validation pipeline ─────────────────────────────────────────────────────

describe("Validation pipeline (real fixtures)", () => {
  it("happy-path fixtures produce zero diagnostics", () => {
    const agents = parseAgents(join(fixturesDir, "agents"));
    const skills = parseSkills(join(fixturesDir, "skills"));
    const mcp = McpConfigSchema.parse(JSON.parse(readFile(join(fixturesDir, "mcp.json"))));
    const diags = [...validateCrossRefs(agents, skills, mcp), ...validateCollisions(agents, skills)];
    expect(diags).toEqual([]);
  });
});
