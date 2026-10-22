import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import type { ParsedRule } from "../../../parsers/rule.js";
import type { ParsedSkill } from "../../../parsers/skill.js";
import { AgentFrontmatterSchema, RuleFrontmatterSchema, type McpServer } from "../../../schema.js";
import { toPlatformSkillMarkdown } from "../../../utils/skill-frontmatter.js";
import type { ProjectBundle } from "../../types.js";
import { buildAntigravityAgentArtifact } from "./agents.js";
import { generateAntigravity } from "./index.js";
import { buildAntigravityMcpArtifact } from "./mcp.js";
import { buildAntigravityRuleArtifact } from "./rules.js";
import { buildAntigravitySkillDirs } from "./skills.js";

function agent(frontmatter: Record<string, unknown>, name = "worker"): ParsedAgent {
  return {
    name,
    frontmatter: AgentFrontmatterSchema.parse({ description: "Does work", tools: {}, ...frontmatter }),
    body: "Body.",
  };
}

function rule(name: string, frontmatter: Record<string, unknown> = {}): ParsedRule {
  return { name, filename: `${name}.md`, frontmatter: RuleFrontmatterSchema.parse(frontmatter), body: "Rule body." };
}

function project(overrides: Partial<ProjectBundle>): ProjectBundle {
  return {
    agents: [],
    skills: [],
    rules: [],
    mcp: { servers: {} },
    permissions: undefined,
    ulisConfig: { version: 1, name: "test", unsupportedPlatformRules: "inject" },
    sourceDir: "/unused",
    ...overrides,
  };
}

function mcpServers(servers: Record<string, McpServer>): Record<string, unknown> {
  return JSON.parse(String(buildAntigravityMcpArtifact({ servers }).contents)).mcpServers;
}

describe("buildAntigravityRuleArtifact", () => {
  it("maps alwaysApply to always_on and drops globs", () => {
    const artifact = buildAntigravityRuleArtifact(rule("a", { alwaysApply: true, description: "D", paths: ["*.go"] }));
    expect(artifact.contents).toBe("---\ntrigger: always_on\ndescription: D\n---\n\nRule body.\n");
  });

  it("maps paths to glob with a comma-joined globs string", () => {
    const artifact = buildAntigravityRuleArtifact(rule("golang/coding-style", { paths: ["**/*.go", "**/go.mod"] }));
    expect(artifact.path).toBe(join("rules", "golang-coding-style.md"));
    expect(artifact.contents).toContain('trigger: glob\nglobs: "**/*.go,**/go.mod"\n');
  });

  it("maps a bare description to model_decision and nothing to always_on", () => {
    expect(buildAntigravityRuleArtifact(rule("d", { description: "When" })).contents).toContain(
      "trigger: model_decision\ndescription: When\n",
    );
    expect(buildAntigravityRuleArtifact(rule("n")).contents).toBe("---\ntrigger: always_on\n---\n\nRule body.\n");
  });

  it("throws when two nested rules flatten to the same path", () => {
    const bundle = project({ rules: [rule("a/b"), rule("a-b")] });
    expect(() => generateAntigravity(bundle)).toThrow("both flatten to");
  });

  it("skips rules disabled for antigravity", () => {
    const bundle = project({ rules: [rule("off", { platforms: { antigravity: { enabled: false } } }), rule("on")] });
    expect(generateAntigravity(bundle).artifacts.map((a) => a.path)).toEqual([
      join("rules", "on.md"),
      "mcp_config.json",
    ]);
  });
});

describe("buildAntigravityMcpArtifact", () => {
  it("writes serverUrl for remote servers and keeps ${VAR} verbatim", () => {
    expect(
      mcpServers({
        remote: { type: "remote", url: "https://x/${REGION}", headers: { Authorization: "Bearer ${TOKEN}" } },
        local: { type: "local", command: "node", args: ["--key", "${KEY}"], env: { API_KEY: "${KEY}" } },
      }),
    ).toEqual({
      remote: { serverUrl: "https://x/${REGION}", headers: { Authorization: "Bearer ${TOKEN}" } },
      local: { command: "node", args: ["--key", "${KEY}"], env: { API_KEY: "${KEY}" } },
    });
  });

  it("marks disabled servers and honours targets", () => {
    expect(
      mcpServers({
        off: { type: "local", command: "a", disabled: true },
        on: { type: "local", command: "a", enabled: true },
        elsewhere: { type: "local", command: "a", targets: ["claude"] },
        here: { type: "local", command: "a", targets: ["antigravity"], localFallback: { command: "b", args: [] } },
      }),
    ).toEqual({ off: { command: "a", disabled: true }, on: { command: "a" }, here: { command: "a" } });
  });
});

describe("buildAntigravityAgentArtifact", () => {
  it("emits name, description, mapped tools and policy comments without the canonical model", () => {
    const artifact = buildAntigravityAgentArtifact(
      agent({
        model: "claude-haiku-4-5-20251001",
        tools: { read: true, edit: true },
        security: { permissionLevel: "readonly" },
      }),
    );
    expect(artifact.path).toBe(join("agents", "worker.md"));
    expect(artifact.contents).toBe(
      [
        "---",
        "name: worker",
        "description: Does work",
        "tools:",
        "  - view_file",
        "  - grep_search",
        "  - replace_file_content",
        "---",
        "",
        "<!--",
        "  [ULIS security]",
        "    permissionLevel: readonly",
        "-->",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
  });

  it("omits canonical mcpServers, maps skills to paths and passes platform fields through", () => {
    const artifact = buildAntigravityAgentArtifact(
      agent({
        tools: { read: false, agent: ["helper"] },
        mcpServers: ["github"],
        skills: ["review"],
        platforms: { antigravity: { enabled: true, model: "pro", commandExecutionPolicy: "off", mainAgent: true } },
      }),
    );
    expect(artifact.contents).toContain(
      'tools:\n  - invoke_subagent\nskills:\n  - skills/review\nmodel: pro\nmainAgent: true\ncommandExecutionPolicy: "off"\n---',
    );
    expect(artifact.contents).not.toContain("mcpServers");
    expect(artifact.contents).not.toContain("enabled");
  });

  it("keeps native mcpServers objects and skills paths from the platform block verbatim", () => {
    const artifact = buildAntigravityAgentArtifact(
      agent({
        skills: ["review"],
        platforms: { antigravity: { mcpServers: [{ serverUrl: "https://y" }], skills: ["other/path"] } },
      }),
    );
    expect(artifact.contents).toContain("skills:\n  - other/path\nmcpServers:\n  - serverUrl: https://y\n---");
  });

  it("keeps a native tools list verbatim, including an empty one, with no unmapped comment", () => {
    const empty = buildAntigravityAgentArtifact(
      agent({ tools: { write: true }, platforms: { antigravity: { tools: [] } } }),
    );
    expect(empty.contents).toContain("tools: []\n");
    expect(empty.contents).not.toContain("[ULIS tools]");
    const native = buildAntigravityAgentArtifact(
      agent({ tools: { write: true }, platforms: { antigravity: { tools: ["run_command"] } } }),
    );
    expect(native.contents).toContain("tools:\n  - run_command\n");
    expect(native.contents).not.toContain("view_file");
  });

  it("comments on capabilities it cannot map and never widens them", () => {
    const flags = buildAntigravityAgentArtifact(agent({ tools: { read: false, write: true, search: true } }));
    expect(flags.contents).toContain("tools: []\n");
    expect(flags.contents).toContain("<!--\n  [ULIS tools]\n    unmapped on antigravity: write, search\n-->\n\nBody.");
    const allowlist = buildAntigravityAgentArtifact(agent({ tools: "Read, Bash" }));
    expect(allowlist.contents).toContain("tools: []\n");
    expect(allowlist.contents).toContain("unmapped on antigravity: Read, Bash");
  });

  it("skips agents disabled for antigravity", () => {
    const bundle = project({
      agents: [agent({ platforms: { antigravity: { enabled: false } } }, "off"), agent({}, "on")],
    });
    expect(generateAntigravity(bundle).artifacts.map((a) => a.path)).toEqual([
      join("agents", "on.md"),
      "mcp_config.json",
    ]);
  });
});

describe("buildAntigravitySkillDirs", () => {
  it("passes platform extras through and strips the canonical model", () => {
    const skill = {
      name: "review",
      dir: "/skills/review",
      body: "",
      frontmatter: { name: "review", description: "Review", platforms: { antigravity: { enabled: true, custom: 1 } } },
    } as unknown as ParsedSkill;
    const [dirs] = buildAntigravitySkillDirs([skill]);
    expect(dirs).toEqual({
      name: "review",
      dir: "/skills/review",
      extraFrontmatter: { custom: 1 },
      stripKeys: ["model"],
    });
    const md = toPlatformSkillMarkdown(
      "---\nname: review\ndescription: Review\nmodel: claude-haiku\n---\nBody.",
      dirs!.extraFrontmatter,
      dirs!.stripKeys,
    );
    expect(md).toContain("name: review\n");
    expect(md).toContain("custom: 1\n");
    expect(md).not.toContain("model:");
  });
});
