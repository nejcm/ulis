import { describe, expect, it } from "bun:test";

import { parse as parseYaml } from "yaml";

import type { ParsedSkill } from "../../../parsers/skill.js";
import type { McpServer } from "../../../schema.js";
import { toPlatformSkillMarkdown } from "../../../utils/skill-frontmatter.js";
import type { ProjectBundle } from "../../types.js";
import { generateHermes } from "./index.js";
import { buildHermesMcpArtifact } from "./mcp.js";
import { buildHermesSkillDirs } from "./skills.js";

function mcpServers(servers: Record<string, McpServer>): Record<string, unknown> {
  return (parseYaml(String(buildHermesMcpArtifact({ servers }).contents)) as { mcp_servers: Record<string, unknown> })
    .mcp_servers;
}

describe("buildHermesMcpArtifact", () => {
  it("writes url/headers and command/args/env, keeping ${VAR} verbatim", () => {
    expect(
      mcpServers({
        remote: { type: "remote", url: "https://x/${REGION}", headers: { Authorization: "Bearer ${TOKEN}" } },
        local: { type: "local", command: "node", args: ["--key", "${KEY}"], env: { API_KEY: "${KEY}" } },
      }),
    ).toEqual({
      remote: { url: "https://x/${REGION}", headers: { Authorization: "Bearer ${TOKEN}" } },
      local: { command: "node", args: ["--key", "${KEY}"], env: { API_KEY: "${KEY}" } },
    });
  });

  it("keeps transport only when it is sse", () => {
    expect(
      mcpServers({
        sse: { type: "remote", url: "https://s", transport: "sse" },
        http: { type: "remote", url: "https://h", transport: "http" },
      }),
    ).toEqual({ sse: { url: "https://s", transport: "sse" }, http: { url: "https://h" } });
  });

  it("marks disabled servers, honours targets and drops localFallback", () => {
    expect(
      mcpServers({
        off: { type: "local", command: "a", disabled: true },
        alsoOff: { type: "local", command: "a", enabled: false },
        on: { type: "local", command: "a", enabled: true },
        elsewhere: { type: "local", command: "a", targets: ["claude"] },
        here: { type: "remote", url: "https://x", targets: ["hermes"], localFallback: { command: "b", args: [] } },
      }),
    ).toEqual({
      off: { command: "a", enabled: false },
      alsoOff: { command: "a", enabled: false },
      on: { command: "a" },
      here: { url: "https://x" },
    });
  });

  it("always emits mcp_servers so an install can prune, and is deterministic", () => {
    expect(buildHermesMcpArtifact({ servers: {} })).toEqual({ path: "config.yaml", contents: "mcp_servers: {}\n" });
    const servers = { a: { type: "local", command: "x".repeat(120) } } as Record<string, McpServer>;
    const first = String(buildHermesMcpArtifact({ servers }).contents);
    expect(first).toBe(String(buildHermesMcpArtifact({ servers }).contents));
    expect(mcpServers(servers)).toEqual({ a: { command: "x".repeat(120) } });
  });
});

describe("generateHermes", () => {
  it("emits config.yaml only and routes skills through the writer", () => {
    const skill = {
      name: "review",
      dir: "/skills/review",
      body: "",
      frontmatter: { name: "review", description: "Review" },
    } as unknown as ParsedSkill;
    const result = generateHermes({
      agents: [],
      skills: [
        skill,
        { ...skill, name: "off", frontmatter: { ...skill.frontmatter, platforms: { hermes: { enabled: false } } } },
      ],
      rules: [],
      mcp: { servers: {} },
      permissions: undefined,
      ulisConfig: { version: 1, name: "test", unsupportedPlatformRules: "inject" },
      sourceDir: "/unused",
    } as unknown as ProjectBundle);
    expect(result.artifacts.map((a) => a.path)).toEqual(["config.yaml"]);
    expect(result.post?.skillDirs?.map((s) => s.name)).toEqual(["review"]);
  });
});

describe("buildHermesSkillDirs", () => {
  it("passes platform extras through as native frontmatter and strips the canonical model", () => {
    const skill = {
      name: "review",
      dir: "/skills/review",
      body: "",
      frontmatter: {
        name: "review",
        description: "Review",
        platforms: {
          hermes: { enabled: true, platforms: ["linux", "macos"], metadata: { hermes: { tags: ["git"] } } },
        },
      },
    } as unknown as ParsedSkill;
    const [dirs] = buildHermesSkillDirs([skill]);
    expect(dirs).toEqual({
      name: "review",
      dir: "/skills/review",
      extraFrontmatter: { platforms: ["linux", "macos"], metadata: { hermes: { tags: ["git"] } } },
      stripKeys: ["model"],
    });
    const md = toPlatformSkillMarkdown(
      "---\nname: review\ndescription: Review\nmodel: claude-haiku\nplatforms:\n  hermes:\n    platforms: [linux]\n---\nBody.",
      dirs!.extraFrontmatter,
      dirs!.stripKeys,
    );
    expect(md).toContain("platforms:\n  - linux\n  - macos\n");
    expect(md).toContain("metadata:\n  hermes:\n    tags:\n      - git\n");
    expect(md).not.toContain("model:");
    expect(md).not.toContain("hermes:\n    platforms");
  });
});
