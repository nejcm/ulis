import { afterEach, describe, expect, it } from "bun:test";
import { dirname, join, resolve } from "node:path";

import { runInstall } from "../../../install.js";
import { platformConfigDir } from "../../../platforms.js";
import { cleanupTempRoots, createTempRoot, readTextFile, writeTextFile } from "../../../test-utils/fs.js";
import { silentLogger } from "../../../test-utils/install.js";
import type { ProjectBundle } from "../../types.js";
import { writeResult } from "../../writer.js";
import { generateOpencode } from "./index.js";

afterEach(cleanupTempRoots);

describe("OpenCode instruction discovery", () => {
  it.each(["project", "global"])("loads the installed rules index and resolves its %s rule", async (scope) => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const userHome = join(root, "home");
    const destBase = scope === "global" ? userHome : join(root, "project");
    const outputDir = join(sourceDir, "generated");
    writeTextFile(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
    writeTextFile(join(sourceDir, "raw/all/AGENTS.md"), "Source instructions.\n");
    const project: ProjectBundle = {
      sourceDir,
      agents: [],
      skills: [],
      rules: [
        { name: "security", filename: "common/security.md", frontmatter: { alwaysApply: false }, body: "Rule body" },
      ],
      mcp: { servers: {} },
      permissions: undefined,
      ulisConfig: { version: 1, name: "test" },
    };
    writeResult(generateOpencode(project), join(outputDir, "opencode"), "opencode", silentLogger);
    await runInstall({
      sourceDir,
      outputDir,
      destBase,
      userHome,
      platforms: ["opencode"],
      rebuild: false,
      installExtensions: false,
      installSkills: false,
      logger: silentLogger,
    });

    const targetDir = platformConfigDir("opencode", destBase, userHome);
    const config = JSON.parse(readTextFile(join(targetDir, "opencode.json")));
    const indexPath =
      scope === "global" ? join(targetDir, "AGENTS.md") : resolve(destBase, config.instructions?.[0] ?? "AGENTS.md");
    expect(indexPath).toBe(join(targetDir, "AGENTS.md"));
    const index = readTextFile(indexPath);
    expect(index).toContain("Source instructions.");
    expect(index).toContain("Resolve relative rule paths from the directory containing this file.");
    const reference = index.match(/`([^`]+security\.md)`/)?.[1];
    expect(reference).toBe("rules/common/security.md");
    expect(readTextFile(resolve(dirname(indexPath), reference!))).toBe("Rule body\n");
  });
});
