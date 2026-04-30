import { describe, expect, it } from "bun:test";

import {
  AgentFrontmatterSchema,
  McpConfigSchema,
  PluginsConfigSchema,
  SkillFrontmatterSchema,
  SkillsConfigSchema,
} from "./schema.js";

describe("AgentFrontmatterSchema", () => {
  it("parses minimal valid agent", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "A test agent",
      tools: { read: true },
    });
    expect(result.description).toBe("A test agent");
    expect(result.model).toBeUndefined();
    expect(result.tags).toEqual([]); // default
    const tools = result.tools;
    if (typeof tools === "string") throw new Error("expected tools object");
    expect(tools.read).toBe(true);
    expect(tools.bash).toBe(false); // default
  });

  it("accepts precise model id", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: {},
      model: "sonnet",
    });
    expect(result.model).toBe("sonnet");
  });

  it("rejects unknown model id", () => {
    expect(() =>
      AgentFrontmatterSchema.parse({
        description: "x",
        tools: {},
        model: "gpt-4",
      }),
    ).toThrow();
  });

  it("rejects missing description", () => {
    expect(() => AgentFrontmatterSchema.parse({ tools: {} })).toThrow();
  });

  it("parses contextHints", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: {},
      contextHints: {
        maxInputTokens: 50000,
        priority: "high",
        excludeFromContext: ["*.log"],
      },
    });
    expect(result.contextHints?.maxInputTokens).toBe(50000);
    expect(result.contextHints?.priority).toBe("high");
    expect(result.contextHints?.excludeFromContext).toEqual(["*.log"]);
  });

  it("contextHints.priority defaults to 'normal'", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: {},
      contextHints: { maxInputTokens: 10000 },
    });
    expect(result.contextHints?.priority).toBe("normal");
  });

  it("parses toolPolicy", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: {},
      toolPolicy: {
        prefer: ["Read"],
        avoid: ["Bash"],
        requireConfirmation: ["Write"],
      },
    });
    expect(result.toolPolicy?.prefer).toEqual(["Read"]);
    expect(result.toolPolicy?.avoid).toEqual(["Bash"]);
    expect(result.toolPolicy?.requireConfirmation).toEqual(["Write"]);
  });

  it("parses security policy", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: {},
      security: {
        permissionLevel: "readonly",
        blockedCommands: ["rm -rf"],
        restrictedPaths: ["secrets/"],
        requireApproval: ["bash", "write"],
        rateLimit: { perHour: 10 },
      },
    });
    expect(result.security?.permissionLevel).toBe("readonly");
    expect(result.security?.blockedCommands).toEqual(["rm -rf"]);
    expect(result.security?.rateLimit?.perHour).toBe(10);
  });

  it("security.permissionLevel defaults to 'readwrite'", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: {},
      security: {},
    });
    expect(result.security?.permissionLevel).toBe("readwrite");
  });

  it("rejects invalid security.requireApproval value", () => {
    expect(() =>
      AgentFrontmatterSchema.parse({
        description: "x",
        tools: {},
        security: { requireApproval: ["network"] }, // not in enum
      }),
    ).toThrow();
  });

  it("parses agent tool allowlist", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: { agent: ["planner", "tester"] },
    });
    const tools = result.tools;
    if (typeof tools === "string") throw new Error("expected tools object");
    expect(tools.agent).toEqual(["planner", "tester"]);
  });

  it("parses platform overrides", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: {},
      platforms: {
        claude: { permissionMode: "plan" },
        opencode: { mode: "primary", rate_limit_per_hour: 20 },
      },
    });
    expect(result.platforms?.claude?.permissionMode).toBe("plan");
    expect(result.platforms?.opencode?.rate_limit_per_hour).toBe(20);
  });
});

describe("SkillFrontmatterSchema", () => {
  it("parses minimal valid skill", () => {
    const result = SkillFrontmatterSchema.parse({ name: "a-skill", description: "A skill" });
    expect(result?.name).toBe("a-skill");
    expect(result?.description).toBe("A skill");
    expect(result?.userInvocable).toBe(true); // default
    expect(result?.allowModelInvocation).toBe(true); // default
    expect(result?.allowImplicitInvocation).toBe(true); // default
    expect(result?.tags).toEqual([]); // default
  });

  it("rejects missing description", () => {
    expect(() => SkillFrontmatterSchema.parse({ name: "a-skill" })).toThrow();
  });

  it("rejects missing name", () => {
    expect(() => SkillFrontmatterSchema.parse({ description: "x" })).toThrow();
  });

  it("enforces Agent Skills naming rules", () => {
    expect(() => SkillFrontmatterSchema.parse({ name: "Bad-Name", description: "x" })).toThrow();
    expect(() => SkillFrontmatterSchema.parse({ name: "-bad", description: "x" })).toThrow();
    expect(() => SkillFrontmatterSchema.parse({ name: "bad--name", description: "x" })).toThrow();
    expect(() => SkillFrontmatterSchema.parse({ name: "bad-", description: "x" })).toThrow();
  });

  it("enforces spec lengths and optional metadata fields", () => {
    const result = SkillFrontmatterSchema.parse({
      name: "skill-name",
      description: "x".repeat(1024),
      compatibility: "Designed for local CLI workflows",
      metadata: { author: "example-org", version: "1.0" },
      "allowed-tools": "Bash(git:*) Read",
    });
    expect(result?.compatibility).toContain("local CLI");
    expect(result?.metadata?.author).toBe("example-org");
    expect(result?.["allowed-tools"]).toContain("Read");

    expect(() =>
      SkillFrontmatterSchema.parse({
        name: "skill-name",
        description: "x",
        compatibility: "x".repeat(501),
      }),
    ).toThrow();

    expect(() =>
      SkillFrontmatterSchema.parse({
        name: "skill-name",
        description: "",
      }),
    ).toThrow();
  });

  it("parses isolation fork", () => {
    const result = SkillFrontmatterSchema.parse({
      name: "x-skill",
      description: "x",
      isolation: "fork",
    });
    expect(result?.isolation).toBe("fork");
  });

  it("parses paths as string or array", () => {
    const single = SkillFrontmatterSchema.parse({
      name: "x-skill",
      description: "x",
      paths: "src/**",
    });
    expect(single?.paths).toBe("src/**");

    const multi = SkillFrontmatterSchema.parse({
      name: "x-skill",
      description: "x",
      paths: ["src/**", "tests/**"],
    });
    expect(multi?.paths).toEqual(["src/**", "tests/**"]);
  });

  it("preserves unknown root fields", () => {
    const result = SkillFrontmatterSchema.parse({
      name: "x-skill",
      description: "x",
      author: "acme-org",
      customField: 42,
    });
    expect((result as Record<string, unknown>).author).toBe("acme-org");
    expect((result as Record<string, unknown>).customField).toBe(42);
  });

  it("preserves unknown fields inside platform overrides", () => {
    const result = SkillFrontmatterSchema.parse({
      name: "x-skill",
      description: "x",
      platforms: {
        claude: { enabled: true, extra_claude_field: "hello" },
        cursor: { enabled: true, cursor_custom: true },
        unknown_platform: { enabled: true },
      },
    });
    expect((result?.platforms?.claude as Record<string, unknown>).extra_claude_field).toBe("hello");
    expect((result?.platforms?.cursor as Record<string, unknown>).cursor_custom).toBe(true);
    expect((result?.platforms as Record<string, unknown>).unknown_platform).toBeDefined();
  });
});

describe("McpConfigSchema", () => {
  it("defaults servers to an empty object", () => {
    const result = McpConfigSchema.parse({});
    expect(result.servers).toEqual({});
  });

  it("parses a local MCP server", () => {
    const result = McpConfigSchema.parse({
      servers: {
        github: {
          type: "local",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          targets: ["claude", "opencode"],
        },
      },
    });
    expect(result.servers.github.type).toBe("local");
    expect(result.servers.github.targets).toContain("claude");
  });

  it("parses a remote MCP server with headers", () => {
    const result = McpConfigSchema.parse({
      servers: {
        context7: {
          type: "remote",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer ${TOKEN}" },
          targets: ["claude"],
        },
      },
    });
    expect(result.servers.context7.url).toBe("https://mcp.example.com");
  });

  it("rejects server with invalid type", () => {
    expect(() =>
      McpConfigSchema.parse({
        servers: { bad: { type: "websocket", targets: [] } },
      }),
    ).toThrow();
  });
});

describe("PluginsConfigSchema", () => {
  it("parses valid plugins config with claude section", () => {
    const result = PluginsConfigSchema.parse({
      claude: {
        plugins: [{ name: "foo", source: "official" }],
      },
    });
    expect(result?.claude?.plugins?.[0]?.name).toBe("foo");
  });

  it("parses config with both wildcard and claude sections", () => {
    const result = PluginsConfigSchema.parse({
      "*": { plugins: [] },
      claude: {
        plugins: [{ name: "frontend-design", source: "official" }],
      },
    });
    expect(result?.claude?.plugins?.[0]?.source).toBe("official");
  });

  it("parses per-platform plugin sections", () => {
    const result = PluginsConfigSchema.parse({
      opencode: { plugins: [{ name: "oc-plugin", source: "official" }] },
      codex: { plugins: [] },
      cursor: { plugins: [] },
    });
    expect(result?.opencode?.plugins?.[0]?.name).toBe("oc-plugin");
  });
});

describe("SkillsConfigSchema", () => {
  it("parses wildcard skills with optional args", () => {
    const result = SkillsConfigSchema.parse({
      "*": {
        skills: [
          { name: "mattpocock/skills/grill-me" },
          { name: "https://skills.sh/vercel-labs/skills", args: ["--skill", "find-skills"] },
        ],
      },
    });
    expect(result["*"]?.skills).toHaveLength(2);
    expect(result["*"]?.skills[1].args).toEqual(["--skill", "find-skills"]);
  });

  it("parses per-platform skill sections", () => {
    const result = SkillsConfigSchema.parse({
      opencode: { skills: [{ name: "opencode-skill" }] },
      codex: { skills: [{ name: "codex-skill", args: ["--yes"] }] },
      cursor: { skills: [] },
      forgecode: { skills: [{ name: "forgecode-skill" }] },
    });
    expect(result.opencode?.skills[0].name).toBe("opencode-skill");
    expect(result.codex?.skills[0].args).toEqual(["--yes"]);
    expect(result.cursor?.skills).toHaveLength(0);
    expect(result.forgecode?.skills[0].name).toBe("forgecode-skill");
  });
});
