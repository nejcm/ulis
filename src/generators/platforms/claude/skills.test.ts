import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ParsedSkill } from "../../../parsers/skill.js";
import type { ProjectBundle } from "../../types.js";
import { writeResult } from "../../writer.js";
import { generateClaude } from "./index.js";
import { buildClaudeSkillDirs } from "./skills.js";

const silentLogger = { info() {}, success() {}, warn() {}, error() {}, dim() {}, header() {} };

function makeSkill(overrides: Partial<ParsedSkill> = {}): ParsedSkill {
  return {
    name: "implement-plan",
    dir: "/abs/skills/implement-plan",
    frontmatter: {
      name: "implement-plan",
      description: "desc",
      userInvocable: true,
      allowModelInvocation: true,
      allowImplicitInvocation: true,
      tags: [],
    },
    body: "Body",
    ...overrides,
  };
}

function createProject(sourceDir: string, skills: readonly ParsedSkill[]): ProjectBundle {
  return {
    agents: [],
    skills,
    rules: [],
    mcp: { servers: {} },
    permissions: undefined,
    ulisConfig: { version: 1, name: "test", unsupportedPlatformRules: "inject" },
    sourceDir,
  };
}

describe("buildClaudeSkillDirs", () => {
  it("returns one entry per skill with name and dir", () => {
    const skills: ParsedSkill[] = [
      makeSkill({ name: "implement-plan", dir: "/abs/a" }),
      makeSkill({
        name: "code-quality",
        dir: "/abs/b",
        frontmatter: {
          name: "code-quality",
          description: "d",
          userInvocable: true,
          allowModelInvocation: true,
          allowImplicitInvocation: true,
          tags: [],
        },
      }),
    ];
    const dirs = buildClaudeSkillDirs(skills);
    expect(dirs).toHaveLength(2);
    expect(dirs[0]).toMatchObject({ name: "implement-plan", dir: "/abs/a" });
    expect(dirs[1]).toMatchObject({ name: "code-quality", dir: "/abs/b" });
  });

  it("prefers platform-specific model over top-level model", () => {
    const skills: ParsedSkill[] = [
      makeSkill({
        frontmatter: {
          name: "implement-plan",
          description: "d",
          userInvocable: true,
          allowModelInvocation: true,
          allowImplicitInvocation: true,
          tags: [],
          model: "claude-sonnet-4-6",
          platforms: { claude: { enabled: true, model: "claude-opus-4-7" } },
        },
      }),
    ];
    expect(buildClaudeSkillDirs(skills)[0]?.extraFrontmatter).toEqual({ model: "claude-opus-4-7" });
  });

  it("falls back to top-level model when no claude override exists", () => {
    const skills: ParsedSkill[] = [
      makeSkill({
        frontmatter: {
          name: "implement-plan",
          description: "d",
          userInvocable: true,
          allowModelInvocation: true,
          allowImplicitInvocation: true,
          tags: [],
          model: "claude-sonnet-4-6",
        },
      }),
    ];
    expect(buildClaudeSkillDirs(skills)[0]?.extraFrontmatter).toEqual({ model: "claude-sonnet-4-6" });
  });

  it("strips the `enabled` flag from extraFrontmatter and keeps loose extras", () => {
    const skills: ParsedSkill[] = [
      makeSkill({
        frontmatter: {
          name: "implement-plan",
          description: "d",
          userInvocable: true,
          allowModelInvocation: true,
          allowImplicitInvocation: true,
          tags: [],
          platforms: { claude: { enabled: true, shell: "bash", customField: "x" } as never },
        },
      }),
    ];
    const extra = buildClaudeSkillDirs(skills)[0]?.extraFrontmatter ?? {};
    expect(extra).not.toHaveProperty("enabled");
    expect(extra).toMatchObject({ shell: "bash", customField: "x" });
  });

  it("returns an empty object when no model or extras are set", () => {
    const dirs = buildClaudeSkillDirs([makeSkill()]);
    expect(dirs[0]?.extraFrontmatter).toEqual({});
  });
});

describe("generateClaude — skill wiring", () => {
  it("includes local skills in post.skillDirs", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "ulis-claude-skills-"));
    const skill = makeSkill();
    const result = generateClaude(createProject(sourceDir, [skill]));
    expect(result.post.skillDirs).toHaveLength(1);
    expect(result.post.skillDirs[0]).toMatchObject({ name: "implement-plan" });
  });

  it("filters out skills explicitly disabled for claude", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "ulis-claude-skills-"));
    const skill = makeSkill({
      frontmatter: {
        name: "implement-plan",
        description: "d",
        userInvocable: true,
        allowModelInvocation: true,
        allowImplicitInvocation: true,
        tags: [],
        platforms: { claude: { enabled: false } },
      },
    });
    const result = generateClaude(createProject(sourceDir, [skill]));
    expect(result.post.skillDirs).toHaveLength(0);
  });

  it("produces no skillDirs when there are no local skills", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "ulis-claude-skills-"));
    const result = generateClaude(createProject(sourceDir, []));
    expect(result.post.skillDirs).toEqual([]);
  });

  it("copies the skill directory to outDir/skills/<name>/SKILL.md end-to-end", () => {
    const root = mkdtempSync(join(tmpdir(), "ulis-claude-skills-e2e-"));
    const sourceDir = join(root, "source");
    const outDir = join(root, "out");
    const skillDir = join(sourceDir, "skills", "implement-plan");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: implement-plan\ndescription: Implement a plan\n---\nBody.\n");

    const skill: ParsedSkill = {
      name: "implement-plan",
      dir: skillDir,
      frontmatter: {
        name: "implement-plan",
        description: "Implement a plan",
        userInvocable: true,
        allowModelInvocation: true,
        allowImplicitInvocation: true,
        tags: [],
      },
      body: "Body.",
    };

    const result = generateClaude(createProject(sourceDir, [skill]));
    writeResult(result, outDir, "claude", silentLogger);

    const dest = join(outDir, "skills", "implement-plan", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toContain("name: implement-plan");
  });
});
