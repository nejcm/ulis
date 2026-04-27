import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ParseAggregateError, ParseError, parseProject } from "./index.js";

const fixturesDir = resolve(join(import.meta.dirname, "../../tests/fixtures"));

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("parseProject (happy path)", () => {
  it("parses agents from fixtures dir", () => {
    const p = parseProject(fixturesDir);
    expect(p.agents.length).toBe(1);
    expect(p.agents[0].name).toBe("worker");
    expect(p.agents[0].frontmatter.description).toBe("A minimal test agent");
  });

  it("parses skills from fixtures dir", () => {
    const p = parseProject(fixturesDir);
    expect(p.skills.length).toBe(1);
    expect(p.skills[0].name).toBe("my-skill");
  });

  it("returns empty rules when rules dir is absent", () => {
    const p = parseProject(fixturesDir);
    expect(p.rules).toEqual([]);
  });

  it("includes mcp, permissions, plugins, ulisConfig, and sourceDir", () => {
    const p = parseProject(fixturesDir);
    expect(Object.keys(p.mcp.servers)).toContain("test-local");
    expect(p.ulisConfig.name).toBe("fixtures");
    expect(p.sourceDir).toBe(fixturesDir);
  });
});

// ─── Missing directory handling ───────────────────────────────────────────────

describe("parseProject (missing directories)", () => {
  it("agents dir missing → agents: [] without crashing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ulis-test-"));
    try {
      writeFileSync(join(tmp, "mcp.json"), JSON.stringify({ servers: {} }));
      writeFileSync(join(tmp, "config.yaml"), "version: 1\nname: test\n");
      const p = parseProject(tmp);
      expect(p.agents).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("skills dir missing → skills: [] without crashing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ulis-test-"));
    try {
      mkdirSync(join(tmp, "agents"));
      writeFileSync(join(tmp, "mcp.json"), JSON.stringify({ servers: {} }));
      writeFileSync(join(tmp, "config.yaml"), "version: 1\nname: test\n");
      const p = parseProject(tmp);
      expect(p.skills).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});

// ─── Aggregate error collection ───────────────────────────────────────────────

describe("parseProject (error collection)", () => {
  function makeAgentFixture(tmpDir: string, name: string, content: string): void {
    const agentsDir = join(tmpDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, `${name}.md`), content);
  }

  const validAgent = `---
description: A valid agent
model: claude-haiku-4-5-20251001
tools:
  read: true
---
Body text.
`;

  const invalidAgent = `---
description: An agent with an invalid model
model: not-a-valid-model-name
tools:
  read: true
---
Body.
`;

  it("throws ParseAggregateError listing all broken files, not just the first", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ulis-test-"));
    try {
      const agentsDir = join(tmp, "agents");
      mkdirSync(agentsDir);
      writeFileSync(join(agentsDir, "bad-a.md"), invalidAgent);
      writeFileSync(join(agentsDir, "bad-b.md"), invalidAgent);
      writeFileSync(join(agentsDir, "good.md"), validAgent);
      writeFileSync(join(tmp, "mcp.json"), JSON.stringify({ servers: {} }));
      writeFileSync(join(tmp, "config.yaml"), "version: 1\nname: test\n");

      expect(() => parseProject(tmp)).toThrow(ParseAggregateError);
      try {
        parseProject(tmp);
      } catch (err) {
        expect(err instanceof ParseAggregateError).toBe(true);
        const agg = err as ParseAggregateError;
        expect(agg.errors.length).toBe(2);
        const files = agg.errors.map((e) => e.file);
        expect(files.some((f) => f.includes("bad-a.md"))).toBe(true);
        expect(files.some((f) => f.includes("bad-b.md"))).toBe(true);
      }
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("good agents alongside bad ones: good items still collected before throwing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ulis-test-"));
    try {
      const agentsDir = join(tmp, "agents");
      mkdirSync(agentsDir);
      writeFileSync(join(agentsDir, "bad.md"), invalidAgent);
      writeFileSync(join(agentsDir, "good.md"), validAgent);
      writeFileSync(join(tmp, "mcp.json"), JSON.stringify({ servers: {} }));
      writeFileSync(join(tmp, "config.yaml"), "version: 1\nname: test\n");

      try {
        parseProject(tmp);
      } catch (err) {
        expect(err instanceof ParseAggregateError).toBe(true);
        const agg = err as ParseAggregateError;
        expect(agg.errors.length).toBe(1);
        expect(agg.errors[0].file).toContain("bad.md");
        expect(agg.errors[0] instanceof ParseError).toBe(true);
        expect(agg.errors[0].kind).toBe("agent");
      }
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("error message includes the file path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ulis-test-"));
    try {
      makeAgentFixture(tmp, "broken", invalidAgent);
      writeFileSync(join(tmp, "mcp.json"), JSON.stringify({ servers: {} }));
      writeFileSync(join(tmp, "config.yaml"), "version: 1\nname: test\n");

      try {
        parseProject(tmp);
      } catch (err) {
        const agg = err as ParseAggregateError;
        expect(agg.message).toContain("broken.md");
      }
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});

// ─── ParseError shape ─────────────────────────────────────────────────────────

describe("ParseError", () => {
  it("carries kind and file", () => {
    const e = new ParseError("agent", "agents/foo.md", new Error("bad"));
    expect(e.kind).toBe("agent");
    expect(e.file).toBe("agents/foo.md");
    expect(e.message).toContain("agents/foo.md");
    expect(e.name).toBe("ParseError");
  });

  it("formats ZodError fields into the message", () => {
    const { ZodError } = require("zod");
    const zErr = new ZodError([
      {
        code: "invalid_type",
        path: ["model"],
        message: "Expected string",
        expected: "string",
        received: "number",
        fatal: false,
      },
    ]);
    const e = new ParseError("agent", "agents/x.md", zErr);
    expect(e.message).toContain("model");
  });
});
