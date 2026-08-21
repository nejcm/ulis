import { describe, expect, it } from "bun:test";

import type { ParsedProject } from "../parsers/index.js";
import { mergeProjects } from "./merge-projects.js";

function project(overrides: Partial<ParsedProject> = {}): ParsedProject {
  const name = overrides.ulisConfig?.name ?? "default";
  return {
    agents: [],
    skills: [],
    rules: [],
    mcp: { servers: {} },
    permissions: undefined,
    ulisConfig: { version: 1, name },
    sourceDir: `/tmp/${name}`,
    ...overrides,
  };
}

describe("mergeProjects", () => {
  it("keeps base project entries for duplicate names", () => {
    const preset = project({
      agents: [{ name: "assistant", body: "preset", frontmatter: {} as never }],
      skills: [{ name: "common", dir: "/preset/common", body: "preset", frontmatter: {} as never }],
      rules: [{ name: "style", filename: "style.md", body: "preset", frontmatter: {} as never }],
      ulisConfig: { version: 1, name: "preset" },
      sourceDir: "/preset",
    });
    const base = project({
      agents: [{ name: "assistant", body: "base", frontmatter: {} as never }],
      skills: [{ name: "common", dir: "/base/common", body: "base", frontmatter: {} as never }],
      rules: [{ name: "style", filename: "style.md", body: "base", frontmatter: {} as never }],
      ulisConfig: { version: 1, name: "base" },
      sourceDir: "/base",
    });

    const merged = mergeProjects([preset, base]);
    expect(merged.agents[0]?.body).toBe("base");
    expect(merged.skills[0]?.body).toBe("base");
    expect(merged.rules[0]?.body).toBe("base");
    expect(merged.ulisConfig.name).toBe("base");
    expect(merged.sourceDir).toBe("/base");
    expect(merged.sourceDirs).toEqual(["/preset", "/base"]);
  });

  it("preserves preset order before base for non-duplicate entries", () => {
    const presetA = project({
      agents: [{ name: "a-agent", body: "a", frontmatter: {} as never }],
      ulisConfig: { version: 1, name: "preset-a" },
      sourceDir: "/preset-a",
    });
    const presetB = project({
      agents: [{ name: "b-agent", body: "b", frontmatter: {} as never }],
      ulisConfig: { version: 1, name: "preset-b" },
      sourceDir: "/preset-b",
    });
    const base = project({
      agents: [{ name: "base-agent", body: "base", frontmatter: {} as never }],
      ulisConfig: { version: 1, name: "base" },
      sourceDir: "/base",
    });

    const merged = mergeProjects([presetA, presetB, base]);
    expect(merged.agents.map((a) => a.name)).toEqual(["a-agent", "b-agent", "base-agent"]);
  });

  describe("permission list merging", () => {
    it("lets a base claude.allow override a preset claude.allow (base-wins, not additive)", () => {
      const preset = project({ permissions: { claude: { allow: ["Bash(*)"] } } });
      const base = project({ permissions: { claude: { allow: ["Read(**)"] } } });

      const merged = mergeProjects([preset, base]);
      expect(merged.permissions?.claude?.allow).toEqual(["Read(**)"]);
    });

    it("keeps a preset claude.allow when the base declares none", () => {
      const preset = project({ permissions: { claude: { allow: ["Bash(*)"] } } });
      const base = project({ permissions: { claude: {} } });

      const merged = mergeProjects([preset, base]);
      expect(merged.permissions?.claude?.allow).toEqual(["Bash(*)"]);
    });

    it("lets a base claude.allow: [] clear a preset's list rather than being ignored as absent", () => {
      const preset = project({ permissions: { claude: { allow: ["Bash(*)"] } } });
      const base = project({ permissions: { claude: { allow: [] } } });

      const merged = mergeProjects([preset, base]);
      expect(merged.permissions?.claude?.allow).toEqual([]);
    });

    it("deduplicates repeated entries within a single layer, preserving first occurrence", () => {
      const preset = project({ permissions: { claude: {} } });
      const base = project({ permissions: { claude: { allow: ["Bash(*)", "Read(**)", "Bash(*)"] } } });

      const merged = mergeProjects([preset, base]);
      expect(merged.permissions?.claude?.allow).toEqual(["Bash(*)", "Read(**)"]);
    });

    it("three layers: a middle preset's claude.allow wins when the top layer doesn't declare it", () => {
      const presetA = project({ permissions: { claude: { allow: ["A"] } } });
      const presetB = project({ permissions: { claude: { allow: ["B"] } } });
      const base = project({ permissions: { claude: {} } });

      const merged = mergeProjects([presetA, presetB, base]);
      expect(merged.permissions?.claude?.allow).toEqual(["B"]);
    });

    it("lets a base cursor.terminalAllowlist override a preset's (base-wins, not additive)", () => {
      const preset = project({ permissions: { cursor: { terminalAllowlist: ["git"] } } });
      const base = project({ permissions: { cursor: { terminalAllowlist: ["npm"] } } });

      const merged = mergeProjects([preset, base]);
      expect(merged.permissions?.cursor?.terminalAllowlist).toEqual(["npm"]);
    });

    it("keeps a preset cursor.terminalAllowlist when the base declares none", () => {
      const preset = project({ permissions: { cursor: { terminalAllowlist: ["git"] } } });
      const base = project({ permissions: { cursor: {} } });

      const merged = mergeProjects([preset, base]);
      expect(merged.permissions?.cursor?.terminalAllowlist).toEqual(["git"]);
    });

    it("lets a base cursor.terminalAllowlist: [] clear a preset's list", () => {
      const preset = project({ permissions: { cursor: { terminalAllowlist: ["git"] } } });
      const base = project({ permissions: { cursor: { terminalAllowlist: [] } } });

      const merged = mergeProjects([preset, base]);
      expect(merged.permissions?.cursor?.terminalAllowlist).toEqual([]);
    });

    it("deduplicates repeated cursor.terminalAllowlist entries within a single layer", () => {
      const preset = project({ permissions: { cursor: {} } });
      const base = project({ permissions: { cursor: { terminalAllowlist: ["git", "npm", "git"] } } });

      const merged = mergeProjects([preset, base]);
      expect(merged.permissions?.cursor?.terminalAllowlist).toEqual(["git", "npm"]);
    });

    it("three layers: a middle preset's cursor.terminalAllowlist wins when the top layer doesn't declare it", () => {
      const presetA = project({ permissions: { cursor: { terminalAllowlist: ["A"] } } });
      const presetB = project({ permissions: { cursor: { terminalAllowlist: ["B"] } } });
      const base = project({ permissions: { cursor: {} } });

      const merged = mergeProjects([presetA, presetB, base]);
      expect(merged.permissions?.cursor?.terminalAllowlist).toEqual(["B"]);
    });
  });
});
