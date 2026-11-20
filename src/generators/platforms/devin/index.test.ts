import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import type { ParsedRule } from "../../../parsers/rule.js";
import type { ParsedSkill } from "../../../parsers/skill.js";
import { AgentFrontmatterSchema, RuleFrontmatterSchema, type McpServer } from "../../../schema.js";
import { toPlatformSkillMarkdown } from "../../../utils/skill-frontmatter.js";
import type { ProjectBundle } from "../../types.js";
import { buildDevinAgentArtifact } from "./agents.js";
import { generateDevin } from "./index.js";
import { buildDevinMcpArtifact } from "./mcp.js";
import { buildDevinSkillDirs } from "./skills.js";

function mcpServers(servers: Record<string, McpServer>): Record<string, unknown> {
  return JSON.parse(String(buildDevinMcpArtifact({ servers }).contents)).mcpServers;
}

const skill = {
  name: "review",
  dir: "/skills/review",
  body: "",
  frontmatter: { name: "review", description: "Review" },
} as unknown as ParsedSkill;

describe("buildDevinMcpArtifact", () => {
  it("writes url/transport/headers and command/args/env, translating ${VAR} to ${env:VAR}", () => {
    expect(
      mcpServers({
        remote: { type: "remote", url: "https://x/${REGION}", headers: { Authorization: "Bearer ${TOKEN}" } },
        local: { type: "local", command: "${BIN}", args: ["--key", "${KEY}"], env: { API_KEY: "${KEY}" } },
      }),
    ).toEqual({
      remote: { url: "https://x/${env:REGION}", transport: "http", headers: { Authorization: "Bearer ${env:TOKEN}" } },
      local: { command: "${env:BIN}", args: ["--key", "${env:KEY}"], env: { API_KEY: "${env:KEY}" } },
    });
  });

  it("keeps an sse transport", () => {
    expect(mcpServers({ sse: { type: "remote", url: "https://s", transport: "sse" } })).toEqual({
      sse: { url: "https://s", transport: "sse" },
    });
  });

  it("marks disabled servers, honours targets and drops localFallback", () => {
    expect(
      mcpServers({
        off: { type: "local", command: "a", disabled: true },
        alsoOff: { type: "remote", url: "https://x", enabled: false },
        on: { type: "local", command: "a", enabled: true },
        elsewhere: { type: "local", command: "a", targets: ["claude"] },
        here: { type: "local", command: "a", targets: ["devin"], localFallback: { command: "b", args: [] } },
      }),
    ).toEqual({
      off: { command: "a", disabled: true },
      alsoOff: { url: "https://x", transport: "http", disabled: true },
      on: { command: "a" },
      here: { command: "a" },
    });
  });

  it("omits a local server without a command and a remote one without a url", () => {
    expect(
      mcpServers({
        noCommand: { type: "local" },
        emptyCommand: { type: "local", command: "" },
        noUrl: { type: "remote" },
        blankCommand: { type: "local", command: "  " },
        blankUrl: { type: "remote", url: " " },
        ok: { type: "local", command: "a" },
      }),
    ).toEqual({ ok: { command: "a" } });
  });

  it("always emits mcpServers so an install can prune", () => {
    expect(buildDevinMcpArtifact({ servers: {} })).toEqual({
      path: "mcp_config.json",
      contents: JSON.stringify({ mcpServers: {} }, null, 2),
    });
  });
});

describe("generateDevin", () => {
  it("emits mcp_config.json only and routes enabled skills through the writer", () => {
    const result = generateDevin({
      agents: [],
      skills: [
        skill,
        { ...skill, name: "off", frontmatter: { ...skill.frontmatter, platforms: { devin: { enabled: false } } } },
      ],
      rules: [],
      mcp: { servers: {} },
      permissions: undefined,
      ulisConfig: { version: 1, name: "test", unsupportedPlatformRules: "inject" },
      sourceDir: "/unused",
    } as unknown as ProjectBundle);
    expect(result.artifacts.map((a) => a.path)).toEqual(["mcp_config.json"]);
    expect(result.post?.skillDirs?.map((s) => s.name)).toEqual(["review"]);
  });
});

describe("generateDevin rules", () => {
  const rule = (name: string, frontmatter: Record<string, unknown> = {}): ParsedRule => ({
    name,
    filename: `${name}.md`,
    frontmatter: RuleFrontmatterSchema.parse(frontmatter),
    body: "Rule body.",
  });
  const generate = (rules: ParsedRule[]) =>
    generateDevin({
      agents: [],
      skills: [],
      rules,
      mcp: { servers: {} },
      ulisConfig: { version: 1, name: "test", unsupportedPlatformRules: "inject" },
      sourceDir: "/unused",
    } as unknown as ProjectBundle);

  it("writes flattened trigger rules and skips rules disabled for devin", () => {
    const result = generate([
      rule("golang/coding-style", { description: "Go", paths: ["**/*.go", "**/go.mod"] }),
      rule("off", { platforms: { devin: { enabled: false } } }),
    ]);
    expect(result.artifacts).toEqual([
      {
        path: join("rules", "golang-coding-style.md"),
        contents: '---\ntrigger: glob\ndescription: Go\nglobs:\n  - "**/*.go"\n  - "**/go.mod"\n---\n\nRule body.\n',
      },
      { path: "mcp_config.json", contents: JSON.stringify({ mcpServers: {} }, null, 2) },
    ]);
  });

  it("throws when two nested rules flatten to the same path", () => {
    expect(() => generate([rule("a/b"), rule("a-b")])).toThrow('Rules "a/b" and "a-b" both flatten to');
  });
});

describe("buildDevinSkillDirs", () => {
  const source = "---\nname: review\ndescription: Review\nmodel: claude-haiku\nallowed-tools: Read Grep\n---\nBody.";
  const markdown = (frontmatter: Record<string, unknown>) => {
    const [dirs] = buildDevinSkillDirs([
      { ...skill, frontmatter: { ...skill.frontmatter, ...frontmatter } } as ParsedSkill,
    ]);
    return toPlatformSkillMarkdown(source, dirs!.extraFrontmatter, dirs!.stripKeys);
  };

  it("drops the canonical model and string allowed-tools", () => {
    const md = markdown({});
    expect(md).not.toContain("model:");
    expect(md).not.toContain("allowed-tools");
    expect(md).toContain("name: review\n");
  });

  it("emits platforms.devin values as native frontmatter, list allowed-tools included", () => {
    const md = markdown({
      platforms: { devin: { enabled: true, model: "swe", triggers: ["user"], "allowed-tools": ["read", "grep"] } },
    });
    expect(md).toContain("model: swe\n");
    expect(md).toContain("triggers:\n  - user\n");
    expect(md).toContain("allowed-tools:\n  - read\n  - grep\n");
    expect(md).not.toContain("claude-haiku");
    expect(md).not.toContain("Read Grep");
    expect(md).not.toContain("enabled");
  });
});

describe("buildDevinAgentArtifact", () => {
  const contents = (frontmatter: Record<string, unknown>, name = "reviewer") =>
    String(
      buildDevinAgentArtifact({
        name,
        body: "Review.\n",
        frontmatter: AgentFrontmatterSchema.parse({ description: "Reviews", ...frontmatter }),
      } as ParsedAgent).contents,
    );
  const every = { read: true, write: true, edit: true, bash: true, search: true, browser: true };

  it("writes agents/<name>.md with name, description, mapped allowed-tools and body, dropping the canonical model", () => {
    const artifact = buildDevinAgentArtifact({
      name: "reviewer",
      body: "Review.\n",
      frontmatter: AgentFrontmatterSchema.parse({ description: "Reviews", model: "opus", tools: { bash: true } }),
    });
    expect(artifact.path.replace(/\\/g, "/")).toBe("agents/reviewer.md");
    expect(artifact.contents).toBe(
      "---\nname: reviewer\ndescription: Reviews\nallowed-tools:\n  - read\n  - grep\n  - glob\n  - exec\n---\n\nReview.\n",
    );
  });

  it("omits allowed-tools without a comment when every tool group is granted, with or without agent", () => {
    for (const agent of [true, false, undefined]) {
      expect(contents({ tools: { ...every, agent } })).toBe(
        "---\nname: reviewer\ndescription: Reviews\n---\n\nReview.\n",
      );
    }
    expect(contents({ tools: { ...every, bash: false } })).toContain("  - webfetch\n---");
  });

  it("emits the platforms.devin tools alias as allowed-tools, replacing the mapped list", () => {
    expect(contents({ tools: { bash: true }, platforms: { devin: { tools: ["read"] } } })).toBe(
      "---\nname: reviewer\ndescription: Reviews\nallowed-tools:\n  - read\n---\n\nReview.\n",
    );
    expect(contents({ tools: "Read", platforms: { devin: { tools: ["read"] } } })).toBe(
      "---\nname: reviewer\ndescription: Reviews\nallowed-tools:\n  - read\n---\n\nReview.\n",
    );
    expect(contents({ tools: {}, platforms: { devin: { "allowed-tools": ["exec"], tools: ["read"] } } })).toContain(
      "allowed-tools:\n  - exec\n---",
    );
  });

  it("omits allowed-tools and lists the canonical tools in a comment when nothing maps", () => {
    const none = { read: false };
    expect(contents({ tools: none })).toBe(
      "---\nname: reviewer\ndescription: Reviews\n---\n\n<!-- [ULIS tools] canonical: none; allowed-tools omitted -->\n\nReview.\n",
    );
    expect(contents({ tools: "Read, Bash" })).toContain(
      "<!-- [ULIS tools] canonical: Read, Bash; allowed-tools omitted -->",
    );
    expect(contents({ tools: "Read", platforms: { devin: { "allowed-tools": ["read"] } } })).not.toContain(
      "[ULIS tools]",
    );
  });

  it("passes platforms.devin through, its allowed-tools replacing the mapped list", () => {
    const c = contents({
      model: "opus",
      tools: {},
      platforms: { devin: { model: "sonnet", "allowed-tools": ["read", "exec"], "max-nesting": 2, color: "blue" } },
    });
    expect(c).toBe(
      "---\nname: reviewer\ndescription: Reviews\nallowed-tools:\n  - read\n  - exec\nmodel: sonnet\nmax-nesting: 2\ncolor: blue\n---\n\nReview.\n",
    );
  });

  it("skips agents disabled for devin", () => {
    const agent = (name: string, devin?: object) =>
      ({
        name,
        body: "",
        frontmatter: AgentFrontmatterSchema.parse({ description: "d", tools: {}, platforms: devin && { devin } }),
      }) as ParsedAgent;
    const { artifacts } = generateDevin({
      agents: [agent("on"), agent("off", { enabled: false })],
      skills: [],
      rules: [],
      mcp: { servers: {} },
      sourceDir: "/unused",
    } as unknown as ProjectBundle);
    expect(artifacts.map((a) => a.path.replace(/\\/g, "/"))).toEqual(["agents/on.md", "mcp_config.json"]);
  });
});
