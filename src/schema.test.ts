import { describe, it, expect } from "bun:test";

import { AgentFrontmatterSchema, SkillFrontmatterSchema, McpConfigSchema, PluginsConfigSchema } from "./schema.js";

describe("AgentFrontmatterSchema", () => {
  it("parses minimal valid agent", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "A test agent",
      tools: { read: true },
    });
    expect(result.description).toBe("A test agent");
    expect(result.model).toBeUndefined();
    expect(result.tags).toEqual([]); // default
    expect(result.tools.read).toBe(true);
    expect(result.tools.bash).toBe(false); // default
  });

  it("accepts precise model id", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: {},
      model: "claude-sonnet-4-6",
    });
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("rejects unknown model id", () => {
    expect(() => AgentFrontmatterSchema.parse({ description: "x", tools: {}, model: "gpt-4" })).toThrow();
  });

  it("rejects missing description", () => {
    expect(() => AgentFrontmatterSchema.parse({ tools: {} })).toThrow();
  });

  it("parses contextHints", () => {
    const result = AgentFrontmatterSchema.parse({
      description: "x",
      tools: {},
      contextHints: { maxInputTokens: 50000, priority: "high", excludeFromContext: ["*.log"] },
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
      toolPolicy: { prefer: ["Read"], avoid: ["Bash"], requireConfirmation: ["Write"] },
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
    expect(result.tools.agent).toEqual(["planner", "tester"]);
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
    const result = SkillFrontmatterSchema.parse({ description: "A skill" });
    expect(result.description).toBe("A skill");
    expect(result.userInvocable).toBe(true); // default
    expect(result.allowModelInvocation).toBe(true); // default
    expect(result.allowImplicitInvocation).toBe(true); // default
    expect(result.tags).toEqual([]); // default
  });

  it("rejects missing description", () => {
    expect(() => SkillFrontmatterSchema.parse({})).toThrow();
  });

  it("parses isolation fork", () => {
    const result = SkillFrontmatterSchema.parse({
      description: "x",
      isolation: "fork",
    });
    expect(result.isolation).toBe("fork");
  });

  it("parses paths as string or array", () => {
    const single = SkillFrontmatterSchema.parse({ description: "x", paths: "src/**" });
    expect(single.paths).toBe("src/**");

    const multi = SkillFrontmatterSchema.parse({ description: "x", paths: ["src/**", "tests/**"] });
    expect(multi.paths).toEqual(["src/**", "tests/**"]);
  });
});

describe("McpConfigSchema", () => {
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
  it("parses valid plugins config", () => {
    const result = PluginsConfigSchema.parse({
      claude: {
        marketplace_plugins: [{ name: "foo", source: "official" }],
        marketplace_skills: [{ name: "bar" }],
      },
    });
    expect(result.claude.marketplace_plugins[0].name).toBe("foo");
  });
});
