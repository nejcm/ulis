import { describe, expect, it } from "bun:test";

import matter from "gray-matter";

import { AgentFrontmatterSchema } from "../../../schema/agent.js";
import { buildClaudeAgentArtifact } from "./agents.js";

function hooksOf(frontmatter: Record<string, unknown>): unknown {
  const parsed = AgentFrontmatterSchema.parse({ tools: { read: true }, ...frontmatter });
  const agent = { name: "a", body: "Body.", frontmatter: parsed };
  return matter(buildClaudeAgentArtifact(agent).contents as string).data.hooks;
}

describe("Claude agent hooks", () => {
  // Claude Code reads every event as `[{ matcher?, hooks: [{ type, command }] }]`; a flat handler is ignored.
  it("nests a handler without a matcher under `hooks`", () => {
    expect(hooksOf({ description: "d", hooks: { Stop: [{ command: "notify" }] } })).toEqual({
      Stop: [{ hooks: [{ type: "command", command: "notify" }] }],
    });
  });

  it("keeps a declared matcher on the group", () => {
    expect(hooksOf({ description: "d", hooks: { PostToolUse: [{ matcher: "Edit", command: "lint" }] } })).toEqual({
      PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "lint" }] }],
    });
  });

  it("puts a blocked command in the handler's `if`, since the matcher matches the tool name only", () => {
    expect(hooksOf({ description: "d", security: { blockedCommands: ["git push"] } })).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", if: "Bash(git push*)", command: 'echo "Blocked by ULIS security policy" >&2; exit 2' },
          ],
        },
      ],
    });
  });
});
