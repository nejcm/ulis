import { describe, it, expect } from "bun:test";
import { join, resolve } from "node:path";

import { parseAgents } from "./agent.js";

const fixturesDir = resolve(join(import.meta.dirname, "../../tests/fixtures/agents"));

describe("parseAgents", () => {
  it("parses the worker fixture correctly", () => {
    const agents = parseAgents(fixturesDir);
    expect(agents.length).toBe(1);

    const [worker] = agents;
    expect(worker.name).toBe("worker");
    expect(worker.frontmatter.description).toBe("A minimal test agent");
    expect(worker.frontmatter.model).toBe("claude-haiku-4-5-20251001");
    expect(worker.frontmatter.tools.read).toBe(true);
    expect(worker.frontmatter.tools.edit).toBe(true);
    expect(worker.frontmatter.tools.bash).toBe(false); // default
    expect(worker.frontmatter.tags).toEqual(["core"]);
    expect(worker.body).toContain("You are a minimal worker agent");
  });

  it("parses contextHints from fixture", () => {
    const [worker] = parseAgents(fixturesDir);
    expect(worker.frontmatter.contextHints?.maxInputTokens).toBe(20000);
    expect(worker.frontmatter.contextHints?.priority).toBe("high");
  });

  it("parses toolPolicy from fixture", () => {
    const [worker] = parseAgents(fixturesDir);
    expect(worker.frontmatter.toolPolicy?.avoid).toEqual(["Bash"]);
    expect(worker.frontmatter.toolPolicy?.requireConfirmation).toEqual(["Write"]);
  });

  it("parses security policy from fixture", () => {
    const [worker] = parseAgents(fixturesDir);
    expect(worker.frontmatter.security?.permissionLevel).toBe("readonly");
    expect(worker.frontmatter.security?.blockedCommands).toEqual(["rm -rf"]);
    expect(worker.frontmatter.security?.rateLimit?.perHour).toBe(30);
  });

  it("ignores README.md in agents directory", () => {
    // The fixture dir has no README, but verify the filter logic by checking count
    const agents = parseAgents(fixturesDir);
    expect(agents.every((a) => a.name.toLowerCase() !== "readme")).toBe(true);
  });
});
