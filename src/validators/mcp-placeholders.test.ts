import { describe, expect, it } from "bun:test";

import { AgentFrontmatterSchema } from "../schema.js";
import { validateAntigravityAgentMcp, validateMcpPlaceholders } from "./mcp-placeholders.js";

function agent(name: string, frontmatter: Record<string, unknown>) {
  return { name, frontmatter: AgentFrontmatterSchema.parse({ description: "d", tools: {}, ...frontmatter }), body: "" };
}

describe("validateMcpPlaceholders", () => {
  it("warns once per placeholder across every scanned field, naming the variable but not the value", () => {
    const diags = validateMcpPlaceholders({
      servers: {
        all: {
          type: "remote",
          url: "https://x/${REGION}",
          command: "run-${BIN}",
          args: ["--token", "${TOKEN}"],
          env: { KEY: "secret-${KEY}" },
          headers: { Authorization: "Bearer ${AUTH}" },
        },
      },
    });
    expect(diags.map((d) => d.fieldPath)).toEqual([
      "servers.all.url",
      "servers.all.command",
      "servers.all.args[1]",
      "servers.all.env.KEY",
      "servers.all.headers.Authorization",
    ]);
    expect(diags[0]).toMatchObject({
      level: "warning",
      entity: "mcp:all",
      relativeFile: "mcp.yaml",
      target: "antigravity",
      message: expect.stringContaining("${REGION} is written verbatim to mcp_config.json"),
    });
    expect(JSON.stringify(diags)).not.toContain("secret-");
  });

  it("stays silent for servers that do not target antigravity or hold no placeholder", () => {
    expect(
      validateMcpPlaceholders({
        servers: {
          elsewhere: { type: "local", command: "${BIN}", targets: ["claude"] },
          literal: { type: "remote", url: "https://x", headers: { A: "b" } },
        },
      }),
    ).toEqual([]);
    expect(
      validateMcpPlaceholders({
        servers: { here: { type: "local", command: "${BIN}", targets: ["antigravity", "claude"] } },
      }),
    ).toHaveLength(1);
  });
});

describe("validateAntigravityAgentMcp", () => {
  it("warns for canonical mcpServers references without a native override", () => {
    const diags = validateAntigravityAgentMcp([
      agent("refs", { mcpServers: ["github"] }),
      agent("native", {
        mcpServers: ["github"],
        platforms: { antigravity: { mcpServers: [{ serverUrl: "https://y" }] } },
      }),
      agent("off", { mcpServers: ["github"], platforms: { antigravity: { enabled: false } } }),
      agent("none", {}),
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      level: "warning",
      entity: "agent:refs",
      fieldPath: "mcpServers[]",
      target: "antigravity",
      message: expect.stringContaining("references not emitted"),
    });
  });
});
