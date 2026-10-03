import { describe, expect, it } from "bun:test";

import type { McpServer } from "../../../schema.js";
import type { ProjectBundle } from "../../types.js";
import { buildCursorConfigArtifacts } from "./config.js";

function mcpServersFor(servers: Record<string, McpServer>): Record<string, unknown> {
  const project = {
    agents: [],
    skills: [],
    rules: [],
    mcp: { servers },
    permissions: undefined,
    ulisConfig: { version: 1, name: "test" },
    sourceDir: "/unused",
  } as unknown as ProjectBundle;
  const mcp = buildCursorConfigArtifacts(project).find((artifact) => artifact.path === "mcp.json");
  return JSON.parse(String(mcp?.contents)).mcpServers;
}

describe("buildCursorConfigArtifacts", () => {
  it("writes placeholders in Cursor's ${env:VAR} syntax", () => {
    const servers = mcpServersFor({
      remote: { type: "remote", url: "https://x/${REGION}", headers: { Authorization: "Bearer ${TOKEN}" } },
      local: { type: "local", command: "node", args: ["--key", "${KEY}"], env: { API_KEY: "${KEY}", MODE: "ci" } },
    });
    expect(servers).toEqual({
      remote: { url: "https://x/${env:REGION}", headers: { Authorization: "Bearer ${env:TOKEN}" } },
      local: { command: "node", args: ["--key", "${env:KEY}"], env: { API_KEY: "${env:KEY}", MODE: "ci" } },
    });
  });

  it("leaves a disabled server out, since mcp.json documents no on/off field", () => {
    const servers = mcpServersFor({
      off: { type: "local", command: "a", disabled: true },
      offEnabled: { type: "remote", url: "https://x", enabled: false },
      on: { type: "local", command: "a", disabled: false },
    });
    expect(servers).toEqual({ on: { command: "a" } });
  });
});
