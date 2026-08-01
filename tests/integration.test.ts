/**
 * Integration snapshot tests.
 * Drives the new pure `generate(platform, project)` façade against the
 * minimal fixture set and asserts key content in the returned artifacts.
 *
 * No filesystem writes — tests read from the pure `GenerationResult` map,
 * which keeps them fast and deterministic.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { parse as parseToml } from "smol-toml";

import { generate } from "../src/generators/index.js";
import type { FileArtifact, ProjectBundle } from "../src/generators/types.js";
import { parseAgents } from "../src/parsers/agent.js";
import { parseProject } from "../src/parsers/index.js";
import { loadMcp } from "../src/parsers/mcp.js";
import { loadPermissions } from "../src/parsers/permissions.js";
import { parseRules } from "../src/parsers/rule.js";
import { parseSkills } from "../src/parsers/skill.js";
import type { Platform } from "../src/platforms.js";
import { UlisConfigSchema } from "../src/schema.js";
import { validateCollisions } from "../src/validators/collisions.js";
import { validateCrossRefs } from "../src/validators/cross-refs.js";
import { GOLDEN_ARTIFACTS } from "./golden-artifacts.js";

const fixturesDir = resolve(join(import.meta.dirname, "fixtures"));
const tmpRoots: string[] = [];

function buildProject(): ProjectBundle {
  return {
    agents: parseAgents(join(fixturesDir, "agents")),
    skills: parseSkills(join(fixturesDir, "skills")),
    rules: parseRules(join(fixturesDir, "rules")),
    mcp: loadMcp(fixturesDir),
    permissions: loadPermissions(fixturesDir),
    ulisConfig: UlisConfigSchema.parse({ version: 1, name: "fixtures" }),
    sourceDir: fixturesDir,
  };
}

function run(platform: Platform): Map<string, string> {
  return runProject(platform, buildProject());
}

function runProject(platform: Platform, project: ProjectBundle): Map<string, string> {
  const result = generate(platform, project);
  if (!result) throw new Error(`No generator for ${platform}`);
  const map = new Map<string, string>();
  for (const a of result.artifacts) {
    const norm = a.path.replace(/\\/g, "/");
    map.set(norm, typeof a.contents === "string" ? a.contents : a.contents.toString("utf8"));
  }
  return map;
}

function createTempSource(): string {
  const sourceDir = mkdtempSync(join(tmpdir(), "ulis-output-fixture-"));
  tmpRoots.push(sourceDir);
  return sourceDir;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function get(map: Map<string, string>, path: string): string {
  const v = map.get(path);
  if (v === undefined) throw new Error(`Artifact not found: ${path}. Have: ${[...map.keys()].join(", ")}`);
  return v;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

function assertSafeRelativeArtifactPath(path: string): void {
  const normalized = path.replace(/\\/g, "/");
  expect(isAbsolute(path)).toBe(false);
  expect(/^[A-Za-z]:[\\/]/u.test(path)).toBe(false);
  expect(normalized.startsWith("/")).toBe(false);
  expect(normalized.split("/")).not.toContain("..");
  expect(normalized.split("/")).not.toContain("");
}

function assertMarkdownFrontmatter(content: string): void {
  if (!content.startsWith("---\n")) return;
  const end = content.indexOf("\n---\n", 4);
  expect(end).toBeGreaterThan(0);
  expect(content.slice(end + "\n---\n".length).length).toBeGreaterThan(0);
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
    expect(mcp.mcpServers["test-local"]).toEqual({
      type: "stdio",
      command: "node",
      args: ["./mcp-server.js"],
      env: { API_KEY: "${TEST_API_KEY}" },
    });
  });

  it("preserves a server's disabled flag in .claude.json", () => {
    const m = runProject("claude", {
      ...buildProject(),
      mcp: {
        servers: {
          disabled: {
            type: "local",
            command: "node",
            disabled: true,
          },
        },
      },
    });

    expect(JSON.parse(get(m, ".claude.json"))).toEqual({
      mcpServers: {
        disabled: {
          type: "stdio",
          command: "node",
          disabled: true,
        },
      },
    });
  });

  it("emits configured Claude permissions in settings.json", () => {
    const m = runProject("claude", {
      ...buildProject(),
      permissions: {
        claude: {
          defaultMode: "acceptEdits",
          allow: ["Bash(git status)"],
          deny: ["Bash(rm -rf*)"],
          ask: ["Edit(**/*.ts)"],
          additionalDirectories: ["../shared"],
        },
      },
    });

    expect(JSON.parse(get(m, "settings.json"))).toEqual({
      permissions: {
        defaultMode: "acceptEdits",
        allow: ["Bash(git status)"],
        deny: ["Bash(rm -rf*)"],
        ask: ["Edit(**/*.ts)"],
        additionalDirectories: ["../shared"],
      },
    });
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

  it("generates command artifacts with OpenCode overrides and README passthrough", () => {
    const sourceDir = createTempSource();
    write(
      join(sourceDir, "commands", "review.md"),
      `---
description: Review current changes
model: claude-haiku-4-5-20251001
agent: base-agent
subtask: false
platforms:
  opencode:
    model: anthropic/sonnet
    agent: worker
    subtask: true
---

Run the review workflow.
`,
    );
    write(join(sourceDir, "commands", "README.md"), "Command docs.\n");

    const m = runProject("opencode", { ...buildProject(), sourceDir });
    const command = get(m, "commands/review.md");
    expect(command).toContain("description: Review current changes");
    expect(command).toContain("model: anthropic/sonnet");
    expect(command).toContain("agent: worker");
    expect(command).toContain("subtask: true");
    expect(command).toContain("Run the review workflow.");
    expect(get(m, "commands/README.md")).toBe("Command docs.\n");
  });
});

// ─── Codex ───────────────────────────────────────────────────────────────────

describe("Codex generator", () => {
  const m = run("codex");

  it("generates config.toml with mcp_servers", () => {
    expect(get(m, "config.toml")).toContain("[mcp_servers.test-local]");
  });

  it("preserves a server's disabled flag in config.toml", () => {
    const config = runProject("codex", {
      ...buildProject(),
      mcp: {
        servers: {
          disabled: {
            type: "local",
            command: "node",
            disabled: true,
          },
        },
      },
    });

    expect(get(config, "config.toml")).toContain('[mcp_servers.disabled]\ncommand = "node"\ndisabled = true');
  });

  it("does not emit implicit root config defaults", () => {
    const config = get(m, "config.toml");
    expect(config).not.toContain("model =");
    expect(config).not.toContain("model_reasoning_effort =");
    expect(config).not.toContain("[windows]");
    expect(config).not.toContain("startup_timeout_sec");
  });

  it("keeps explicit Codex permission config", () => {
    const result = generate("codex", {
      ...buildProject(),
      permissions: {
        codex: {
          approvalMode: "on-request",
          sandbox: "workspace-write",
        },
      },
    });
    const config = result!.artifacts.find((artifact) => artifact.path === "config.toml")!.contents as string;
    expect(config).toContain('approval_policy = "on-request"');
    expect(config).toContain("[windows]");
    expect(config).toContain('sandbox = "workspace-write"');
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

  it("generates openai.yaml for Codex skill UI, policy, dependencies, and extras", () => {
    const sourceDir = createTempSource();
    write(
      join(sourceDir, "skills", "ui-skill", "SKILL.md"),
      `---
name: ui-skill
description: UI skill
allowImplicitInvocation: false
platforms:
  codex:
    model: gpt-5.4
    displayName: UI Skill
    shortDescription: Helps with UI
    iconSmall: icon-sm
    brandColor: "#336699"
    defaultPrompt: Start here
    mcpDependencies:
      - type: mcp
        value: browser
        description: Browser tools
        transport: http
        url: https://example.com/mcp
    customField: keep-me
---

Do UI work.
`,
    );

    const m = runProject("codex", { ...buildProject(), sourceDir, skills: parseSkills(join(sourceDir, "skills")) });
    const yaml = get(m, "skills/ui-skill/agents/openai.yaml");
    expect(yaml).toContain('model: "gpt-5.4"');
    expect(yaml).toContain("interface:");
    expect(yaml).toContain('display_name: "UI Skill"');
    expect(yaml).toContain("allow_implicit_invocation: false");
    expect(yaml).toContain("dependencies:");
    expect(yaml).toContain('value: "browser"');
    expect(yaml).toContain('url: "https://example.com/mcp"');
    expect(yaml).toContain("customField: keep-me");
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

  it("preserves a server's disabled flag in mcp.json", () => {
    const m = runProject("cursor", {
      ...buildProject(),
      mcp: {
        servers: {
          disabled: {
            type: "local",
            command: "npx",
            disabled: true,
          },
        },
      },
    });

    expect(JSON.parse(get(m, "mcp.json"))).toEqual({
      mcpServers: {
        disabled: {
          command: "npx",
          disabled: true,
        },
      },
    });
  });

  it("emits permissions.json when Cursor allowlists are configured", () => {
    const m = runProject("cursor", {
      ...buildProject(),
      permissions: {
        cursor: {
          mcpAllowlist: ["github:*", "*:list_*"],
          terminalAllowlist: ["git", "npm test"],
        },
      },
    });

    expect(JSON.parse(get(m, "permissions.json"))).toEqual({
      mcpAllowlist: ["github:*", "*:list_*"],
      terminalAllowlist: ["git", "npm test"],
    });
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
  it("emits rule artifacts through Cursor rules and Codex/OpenCode AGENTS indexes", () => {
    const sourceDir = createTempSource();
    write(
      join(sourceDir, "rules", "common", "security.md"),
      `---
description: Security rules
paths:
  - "**/*.ts"
alwaysApply: true
---

Review security-sensitive changes.
`,
    );
    const project = { ...buildProject(), sourceDir, rules: parseProject(sourceDir).rules };

    const cursor = runProject("cursor", project);
    const cursorRule = get(cursor, "rules/common/security.mdc");
    expect(cursorRule).toContain("description: Security rules");
    expect(cursorRule).toContain('  - "**/*.ts"');
    expect(cursorRule).toContain("alwaysApply: true");
    expect(cursorRule).toContain("Review security-sensitive changes.");

    for (const platform of ["codex", "opencode"] as const) {
      const result = generate(platform, project);
      expect(
        result?.artifacts.some((artifact) => artifact.path.replace(/\\/g, "/") === "rules/common/security.md"),
      ).toBe(true);
      expect(result?.post.appendAfterRaw).toEqual([
        {
          path: "AGENTS.md",
          content: expect.stringContaining("rules/common/security.md"),
        },
      ]);
    }
  });

  it("emits structurally valid and safe relative artifacts", () => {
    for (const platform of ["claude", "codex", "cursor", "opencode", "forgecode"] as const) {
      const result = generate(platform, buildProject());
      expect(result).toBeDefined();
      for (const art of result!.artifacts as readonly FileArtifact[]) {
        const path = art.path.replace(/\\/g, "/");
        const contents = typeof art.contents === "string" ? art.contents : art.contents.toString("utf8");
        assertSafeRelativeArtifactPath(path);

        if (path.endsWith(".json")) {
          expect(() => JSON.parse(contents)).not.toThrow();
        }
        if (path.endsWith(".toml")) {
          expect(() => parseToml(contents)).not.toThrow();
        }
        if (path.endsWith(".md") || path.endsWith(".mdc")) {
          assertMarkdownFrontmatter(contents);
        }
      }
    }
  });

  it("matches golden artifacts for representative platform outputs", () => {
    for (const [platform, expectedByPath] of Object.entries(GOLDEN_ARTIFACTS)) {
      const map = run(platform as Platform);
      for (const [path, expected] of Object.entries(expectedByPath)) {
        expect(normalizeText(get(map, path))).toBe(normalizeText(expected));
      }
    }
  });

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
