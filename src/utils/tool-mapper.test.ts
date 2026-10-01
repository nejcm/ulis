import { describe, it, expect } from "bun:test";

import type { ToolPermissions } from "../schema.js";
import { mapOpencodeTools, mapTools } from "./tool-mapper.js";

const empty: ToolPermissions = {
  read: false,
  write: false,
  edit: false,
  bash: false,
  search: false,
  browser: false,
};

const all: ToolPermissions = {
  read: true,
  write: true,
  edit: true,
  bash: true,
  search: true,
  browser: true,
};

describe("mapTools — claude", () => {
  it("returns empty for empty permissions", () => {
    expect(mapTools(empty, "claude")).toEqual([]);
  });

  it("includes Read/Glob/Grep when read=true", () => {
    const out = mapTools({ ...empty, read: true }, "claude");
    expect(out).toContain("Read");
    expect(out).toContain("Glob");
    expect(out).toContain("Grep");
  });

  it("includes every group when all permissions are on", () => {
    const out = mapTools(all, "claude");
    expect(out).toEqual(
      expect.arrayContaining(["Read", "Write", "Edit", "Bash", "WebSearch", "WebFetch", "mcp__playwright__navigate"]),
    );
  });

  it("emits Agent for agent=true", () => {
    const out = mapTools({ ...empty, agent: true }, "claude");
    expect(out).toContain("Agent");
  });

  it("emits Agent(allowlist) for agent=string[]", () => {
    const out = mapTools({ ...empty, agent: ["worker", "reviewer"] }, "claude");
    expect(out).toContain("Agent(worker, reviewer)");
  });
});

describe("mapTools — cursor", () => {
  it("returns Cursor-flavoured tool names", () => {
    const out = mapTools(all, "cursor");
    expect(out).toContain("read_file");
    expect(out).toContain("write_file");
    expect(out).toContain("edit_file");
    expect(out).toContain("run_terminal_command");
  });

  it("does NOT emit Agent for cursor", () => {
    const out = mapTools({ ...empty, agent: true }, "cursor");
    expect(out).not.toContain("Agent");
  });
});

describe("mapTools — opencode/codex", () => {
  it("returns empty for opencode (see mapOpencodeTools)", () => {
    expect(mapTools(all, "opencode")).toEqual([]);
  });

  it("returns empty for codex (no per-agent tool list)", () => {
    expect(mapTools(all, "codex")).toEqual([]);
  });
});

describe("mapOpencodeTools", () => {
  it("maps canonical flags to OpenCode tool ids as booleans", () => {
    expect(mapOpencodeTools({ ...empty, read: true, write: true, search: true, browser: true })).toEqual({
      read: true,
      glob: true,
      grep: true,
      list: true,
      edit: true,
      bash: false,
      webfetch: true,
      websearch: true,
    });
  });

  it("maps any subagent permission to task", () => {
    expect(mapOpencodeTools({ ...empty, agent: ["reviewer"] }).task).toBe(true);
    expect(mapOpencodeTools({ ...empty, agent: false }).task).toBe(false);
    expect(mapOpencodeTools(empty)).not.toHaveProperty("task");
  });

  it("turns the string form into an allowlist", () => {
    expect(Object.entries(mapOpencodeTools("read, bash"))).toEqual([
      ["*", false],
      ["read", true],
      ["bash", true],
    ]);
  });
});
