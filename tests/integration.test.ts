/**
 * Integration snapshot tests.
 * Drives the new pure `generate(platform, project)` façade against the
 * minimal fixture set and asserts key content in the returned artifacts.
 *
 * No filesystem writes — tests read from the pure `GenerationResult` map,
 * which keeps them fast and deterministic.
 */
import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";

import { generate } from "../src/generators/index.js";
import type { FileArtifact, ProjectBundle } from "../src/generators/types.js";
import { parseAgents } from "../src/parsers/agent.js";
import { loadMcp } from "../src/parsers/mcp.js";
import { loadPermissions } from "../src/parsers/permissions.js";
import { loadPlugins } from "../src/parsers/plugins.js";
import { parseRules } from "../src/parsers/rule.js";
import { parseSkills } from "../src/parsers/skill.js";
import type { Platform } from "../src/platforms.js";
import { UlisConfigSchema } from "../src/schema.js";
import { validateCollisions } from "../src/validators/collisions.js";
import { validateCrossRefs } from "../src/validators/cross-refs.js";

const fixturesDir = resolve(join(import.meta.dirname, "fixtures"));

function buildProject(): ProjectBundle {
  return {
    agents: parseAgents(join(fixturesDir, "agents")),
    skills: parseSkills(join(fixturesDir, "skills")),
    rules: parseRules(join(fixturesDir, "rules")),
    mcp: loadMcp(fixturesDir),
    permissions: loadPermissions(fixturesDir),
    plugins: loadPlugins(fixturesDir),
    ulisConfig: UlisConfigSchema.parse({ version: 1, name: "fixtures" }),
    sourceDir: fixturesDir,
  };
}

function run(platform: Platform): Map<string, string> {
  const result = generate(platform, buildProject());
  if (!result) throw new Error(`No generator for ${platform}`);
  const map = new Map<string, string>();
  for (const a of result.artifacts) {
    const norm = a.path.replace(/\\/g, "/");
    map.set(norm, typeof a.contents === "string" ? a.contents : a.contents.toString("utf8"));
  }
  return map;
}

function get(map: Map<string, string>, path: string): string {
  const v = map.get(path);
  if (v === undefined) throw new Error(`Artifact not found: ${path}. Have: ${[...map.keys()].join(", ")}`);
  return v;
}

// ─── Claude ──────────────────────────────────────────────────────────────────

describe("Claude generator", () => {
  const m = run("claude");

  it("generates agent .md with correct frontmatter", () => {
    const c = get(m, "agents/worker.md");
    expect(c).toContain("name: worker");
    expect(c).toContain("description: A minimal test agent");
    expect(c).toContain("model: claude-haiku-4-5-20251001");
  });

  it("applies readonly security as permissionMode: plan", () => {
    expect(get(m, "agents/worker.md")).toContain("permissionMode: plan");
  });

  it("adds toolPolicy.avoid to disallowedTools", () => {
    const c = get(m, "agents/worker.md");
    expect(c).toContain("disallowedTools:");
    expect(c).toContain("Bash");
  });

  it("synthesizes PreToolUse hook for blockedCommands", () => {
    const c = get(m, "agents/worker.md");
    expect(c).toContain("hooks:");
    expect(c).toContain("PreToolUse:");
    expect(c).toContain("Bash(rm -rf*)");
  });

  it("embeds contextHints + toolPolicy as HTML comment in body", () => {
    const c = get(m, "agents/worker.md");
    expect(c).toContain("<!--");
    expect(c).toContain("[ULIS contextHints]");
    expect(c).toContain("maxInputTokens: 20000");
    expect(c).toContain("[ULIS toolPolicy]");
  });

  it("generates settings.json without mcpServers", () => {
    const settings = JSON.parse(get(m, "settings.json"));
    expect(settings).not.toHaveProperty("mcpServers");
  });

  it("generates .claude.json with all targeted servers", () => {
    const mcp = JSON.parse(get(m, ".claude.json"));
    expect(mcp.mcpServers).toHaveProperty("test-local");
    expect(mcp.mcpServers).toHaveProperty("test-remote");
  });
});

// ─── OpenCode ────────────────────────────────────────────────────────────────

describe("OpenCode generator", () => {
  const m = run("opencode");

  it("generates opencode.json with agent block", () => {
    const oc = JSON.parse(get(m, "opencode.json"));
    expect(oc.agent).toHaveProperty("worker");
    expect(oc.agent.worker.model).toBeDefined();
  });

  it("maps readonly security to deny permissions", () => {
    const oc = JSON.parse(get(m, "opencode.json"));
    expect(oc.agent.worker.permission?.edit).toBe("deny");
    expect(oc.agent.worker.permission?.bash).toBe("deny");
  });

  it("emits rate_limit_per_hour from security.rateLimit", () => {
    const oc = JSON.parse(get(m, "opencode.json"));
    expect(oc.agent.worker.rate_limit_per_hour).toBe(30);
  });

  it("includes MCP servers for opencode target", () => {
    const oc = JSON.parse(get(m, "opencode.json"));
    expect(oc.mcp).toHaveProperty("test-local");
    expect(oc.mcp).toHaveProperty("test-remote");
  });
});

// ─── Codex ───────────────────────────────────────────────────────────────────

describe("Codex generator", () => {
  const m = run("codex");

  it("generates config.toml with mcp_servers", () => {
    expect(get(m, "config.toml")).toContain("[mcp_servers.test-local]");
  });

  it("generates agent TOML with policy comments", () => {
    const toml = get(m, "agents/worker.toml");
    expect(toml).toContain('name = "worker"');
    expect(toml).toContain("# [ULIS contextHints]");
    expect(toml).toContain("#   maxInputTokens: 20000");
    expect(toml).toContain("# [ULIS toolPolicy]");
    expect(toml).toContain("# [ULIS security]");
    expect(toml).toContain("#   permissionLevel: readonly");
  });

  it("preserves non-ULIS SKILL.md frontmatter for codex skills", () => {
    const skill = get(m, "skills/my-skill/SKILL.md");
    expect(skill).toContain("---");
    expect(skill).toContain("name: my-skill");
    expect(skill).toContain("description: A minimal test skill");
    expect(skill).toContain("custom_agent_hint: keep-me");
    expect(skill).not.toContain("allowImplicitInvocation:");
    expect(skill).not.toContain("platforms:");
  });
});

// ─── Cursor ──────────────────────────────────────────────────────────────────

describe("Cursor generator", () => {
  const m = run("cursor");

  it("generates agent .mdc with model", () => {
    const mdc = get(m, "agents/worker.mdc");
    expect(mdc).toContain("description: A minimal test agent");
    expect(mdc).toContain("model:");
  });

  it("embeds policy as HTML comment in mdc body", () => {
    const mdc = get(m, "agents/worker.mdc");
    expect(mdc).toContain("<!--");
    expect(mdc).toContain("[ULIS contextHints]");
  });

  it("generates mcp.json with all targeted servers", () => {
    const mcp = JSON.parse(get(m, "mcp.json"));
    expect(mcp.mcpServers).toHaveProperty("test-local");
    expect(mcp.mcpServers).toHaveProperty("test-remote");
  });
});

// ─── ForgeCode ───────────────────────────────────────────────────────────────

describe("ForgeCode generator", () => {
  const m = run("forgecode");

  it("generates agent markdown with Forge frontmatter", () => {
    const c = get(m, ".forge/agents/worker.md");
    expect(c).toContain("id: worker");
    expect(c).toContain("description: A minimal test agent");
    expect(c).toContain("tools:");
  });

  it("generates .forge/.mcp.json with all targeted servers", () => {
    const mcp = JSON.parse(get(m, ".forge/.mcp.json"));
    expect(mcp.mcpServers).toHaveProperty("test-local");
    expect(mcp.mcpServers).toHaveProperty("test-remote");
    expect(mcp.mcpServers["test-remote"].type).toBe("http");
  });
});

// ─── Generator boundary ──────────────────────────────────────────────────────

describe("Generator boundary", () => {
  it("is pure: two runs produce byte-identical artifacts", () => {
    const a = run("claude");
    const b = run("claude");
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("returns FileArtifact[] for every registered platform", () => {
    for (const platform of ["claude", "codex", "cursor", "opencode", "forgecode"] as const) {
      const result = generate(platform, buildProject());
      expect(result).toBeDefined();
      expect(Array.isArray(result!.artifacts)).toBe(true);
      expect(result!.artifacts.length).toBeGreaterThan(0);
      for (const art of result!.artifacts as readonly FileArtifact[]) {
        expect(typeof art.path).toBe("string");
        expect(art.path.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── Validation pipeline ─────────────────────────────────────────────────────

describe("Validation pipeline (real fixtures)", () => {
  it("happy-path fixtures produce zero diagnostics", () => {
    const p = buildProject();
    const diags = [...validateCrossRefs(p.agents, p.skills, p.mcp), ...validateCollisions(p.agents, p.skills)];
    expect(diags).toEqual([]);
  });
});
