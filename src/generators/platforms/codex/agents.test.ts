import { describe, expect, it } from "bun:test";

import { parse } from "smol-toml";

import { AgentFrontmatterSchema } from "../../../schema.js";
import { buildCodexAgentArtifact } from "./agents.js";

describe("buildCodexAgentArtifact", () => {
  it("lets platforms.codex extras replace generated keys instead of duplicating them", () => {
    const frontmatter = AgentFrontmatterSchema.parse({
      description: "Generated description",
      tools: {},
      platforms: {
        codex: {
          name: "custom",
          description: "Codex description",
          developer_instructions: "Codex instructions",
          approval_policy: "never",
        },
      },
    });

    const artifact = buildCodexAgentArtifact({ name: "worker", frontmatter, body: "Body" });

    expect(parse(String(artifact.contents))).toEqual({
      name: "custom",
      description: "Codex description",
      developer_instructions: "Codex instructions",
      approval_policy: "never",
    });
  });
});
