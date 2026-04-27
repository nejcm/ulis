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
    plugins: undefined,
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
});
