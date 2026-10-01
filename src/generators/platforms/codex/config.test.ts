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
});
