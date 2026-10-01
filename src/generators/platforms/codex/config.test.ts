import { describe, expect, it } from "bun:test";

import { parse } from "smol-toml";

import type { McpServer } from "../../../schema.js";
import type { ProjectBundle } from "../../types.js";
import { buildCodexConfigToml } from "./config.js";

function configFor(servers: Record<string, McpServer>): Record<string, Record<string, unknown>> {
  const project = {
    agents: [],
    skills: [],
    rules: [],
    mcp: { servers },
    permissions: undefined,
    ulisConfig: { version: 1, name: "test" },
    sourceDir: "/unused",
  } as unknown as ProjectBundle;
  return parse(buildCodexConfigToml(project)).mcp_servers as Record<string, Record<string, unknown>>;
}

describe("buildCodexConfigToml", () => {
  it("emits enabled, never disabled, from either canonical switch", () => {
    const servers = configFor({
      off: { type: "local", command: "a", disabled: true },
      offEnabled: { type: "remote", url: "https://x", enabled: false },
      on: { type: "local", command: "a", disabled: false },
      unset: { type: "local", command: "a" },
    });
    expect(servers.off).toEqual({ command: "a", enabled: false });
    expect(servers.offEnabled).toEqual({ url: "https://x", enabled: false });
    expect(servers.on).toEqual({ command: "a", enabled: true });
    expect(servers.unset).toEqual({ command: "a" });
  });

  it("uses bearer_token_env_var only for the Authorization header", () => {
    const servers = configFor({
      api: {
        type: "remote",
        url: "https://x",
        headers: {
          "X-Api-Key": "Bearer ${OTHER}",
          authorization: "Bearer ${TOKEN}",
          "X-Tenant": "${TENANT}",
          "X-Static": "fixed",
        },
      },
    });
    expect(servers.api).toEqual({
      url: "https://x",
      bearer_token_env_var: "TOKEN",
      http_headers: { "X-Api-Key": "Bearer ${OTHER}", "X-Static": "fixed" },
      env_http_headers: { "X-Tenant": "TENANT" },
    });
  });
});
