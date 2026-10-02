import { describe, expect, it } from "bun:test";

import { AgentFrontmatterSchema } from "../../../schema.js";
import type { ProjectBundle } from "../../types.js";
import { buildOpencodeJson } from "./config.js";

const project = { mcp: { servers: {} }, permissions: undefined } as unknown as ProjectBundle;

describe("buildOpencodeJson", () => {
  it("restricts subagents to the canonical allowlist through permission.task", () => {
    const frontmatter = AgentFrontmatterSchema.parse({
      description: "Lead",
      tools: { read: true, agent: ["reviewer", "tester"] },
    });

    const config = JSON.parse(buildOpencodeJson(project, [{ name: "lead", frontmatter, body: "Body" }]));

    expect(config.agent.lead.tools.task).toBe(true);
    expect(Object.entries(config.agent.lead.permission.task)).toEqual([
      ["*", "deny"],
      ["reviewer", "allow"],
      ["tester", "allow"],
    ]);
  });
});

it("uses OpenCode substitution syntax for local MCP environment", () => {
  const config = JSON.parse(
    buildOpencodeJson(
      {
        ...project,
        mcp: {
          servers: {
            local: { type: "local", command: "server", env: { TOKEN: "prefix-${TOKEN}" } },
          },
        },
      },
      [],
    ),
  );
  const substituted = JSON.stringify(config).replace(/\{env:([^}]+)\}/g, (_, name) =>
    name === "TOKEN" ? "secret" : "",
  );
  expect(JSON.parse(substituted).mcp.local.environment.TOKEN).toBe("prefix-secret");
});
