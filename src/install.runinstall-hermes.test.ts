import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import type { Logger } from "./build.js";
import { __test, runInstall } from "./install.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

function hermesSource(global: boolean) {
  const root = createTempRoot();
  const sourceDir = join(root, ".ulis");
  const projectDir = join(root, "project");
  const userHome = join(root, "home");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(userHome, { recursive: true });
  write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
  write(join(sourceDir, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review\n---\nBody.\n");
  const warnings: string[] = [];
  const logger: Logger = { ...silentLogger, warn: (message) => warnings.push(message) };
  const targetDir = join(global ? userHome : projectDir, ".hermes");
  const options = {
    sourceDir,
    outputDir: join(sourceDir, "generated"),
    destBase: global ? userHome : projectDir,
    userHome,
    platforms: ["hermes"] as const,
    rebuild: true,
    installSkills: false,
    installExtensions: false,
    logger,
  };
  const config = join(targetDir, "config.yaml");
  const manifest = () =>
    JSON.parse(read(join(targetDir, ".ulis-manifest.json"))) as { rootEntries: string[]; mcpServers: string[] };
  const servers = () => Object.keys((parseYaml(read(config)) as { mcp_servers: object }).mcp_servers).sort();
  return { root, sourceDir, projectDir, targetDir, config, options, warnings, manifest, servers };
}

const MANAGED = "servers:\n  managed:\n    type: local\n    command: server\n";

describe("runInstall hermes global", () => {
  it("merges mcp_servers into config.yaml, keeps other keys and unmanaged servers, prunes only managed ones", async () => {
    const { sourceDir, config, options, manifest, servers } = hermesSource(true);
    write(config, "# c\nmodel:\n  default: x\nmcp_servers:\n  mine:\n    command: old\n");
    write(join(sourceDir, "mcp.yaml"), MANAGED);
    await runInstall(options);
    expect(servers()).toEqual(["managed", "mine"]);
    expect((parseYaml(read(config)) as any).model.default).toBe("x");
    expect(manifest().mcpServers).toEqual(["managed"]);
    expect(manifest().rootEntries).not.toContain("config.yaml");

    const afterFirst = read(config);
    await runInstall(options);
    expect(read(config)).toBe(afterFirst);

    write(join(sourceDir, "mcp.yaml"), "servers: {}\n");
    await runInstall(options);
    expect(servers()).toEqual(["mine"]);
    expect((parseYaml(read(config)) as any).model.default).toBe("x");
    expect(manifest().mcpServers).toEqual([]);

    write(join(sourceDir, "mcp.yaml"), MANAGED);
    await runInstall(options);
    write(join(sourceDir, "mcp.yaml"), "servers: {}\n");
    await runInstall({ ...options, prune: false });
    expect(servers()).toEqual(["managed", "mine"]);
  });

  it("leaves a config.yaml already equal to the merge byte-identical, comments included", async () => {
    const { sourceDir, config, options, warnings } = hermesSource(true);
    const original =
      "# keep me\nmodel:   { default: x }\n\nmcp_servers:\n  managed:   # comment\n    command: server\n";
    write(config, original);
    write(join(sourceDir, "mcp.yaml"), MANAGED);
    await runInstall(options);
    expect(read(config)).toBe(original);
    expect(warnings.filter((w) => w.includes("comments"))).toEqual([]);
  });

  it("warns once when a commented config.yaml is rewritten", async () => {
    const { sourceDir, config, options, warnings } = hermesSource(true);
    write(config, "# c\nmcp_servers: {}\n");
    write(join(sourceDir, "mcp.yaml"), MANAGED);
    await runInstall(options);
    expect(read(config)).not.toContain("# c");
    expect(warnings.filter((w) => w.includes("config.yaml: rewritten without its comments"))).toHaveLength(1);
  });

  it("writes skills flat under skills/<name>", async () => {
    const { targetDir, options } = hermesSource(true);
    await runInstall(options);
    expect(read(join(targetDir, "skills", "review", "SKILL.md"))).toContain("name: review");
  });
});

describe("runInstall hermes project", () => {
  it("writes skills only, never config.yaml, and claims neither it nor MCP servers", async () => {
    const { sourceDir, projectDir, targetDir, config, options, manifest } = hermesSource(false);
    const existing = "# mine\nmcp_servers:\n  mine:\n    command: old\n";
    write(config, existing);
    write(join(sourceDir, "mcp.yaml"), MANAGED);
    await runInstall(options);
    await runInstall(options);
    expect(read(join(targetDir, "skills", "review", "SKILL.md"))).toContain("name: review");
    expect(read(config)).toBe(existing);
    expect(manifest().mcpServers).toEqual([]);
    expect(manifest().rootEntries).not.toContain("config.yaml");
    expect(existsSync(join(projectDir, ".agents"))).toBe(false);
  });
});
