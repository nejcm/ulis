import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { __test, runInstall } from "./install.js";
import { platformConfigDir } from "./platforms.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

const MANAGED = "servers:\n  managed:\n    type: local\n    command: server\n    env:\n      KEY: ${KEY}\n";
const USER_CONFIG =
  '{\n  // saved approvals\n  "permissions": { "allow": ["Exec(git)"] },\n  "agent": { "model": "swe" } /* pinned */\n}\n';
const USER_MCP =
  '{\n  // mine\n  "mcpServers": { "user": { "command": "user-server", "args": ["--url=https://x//y"] } }\n}\n';
const LOCAL_MCP = '{ "mcpServers": { "personal": { "command": "mine" } } }\n';

const USER_SERVER = { user: { command: "user-server", args: ["--url=https://x//y"] } };

function devinSource(global: boolean) {
  const root = createTempRoot();
  const sourceDir = join(root, ".ulis");
  const userHome = join(root, "home");
  const destBase = global ? userHome : join(root, "project");
  mkdirSync(destBase, { recursive: true });
  mkdirSync(userHome, { recursive: true });
  write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
  write(join(sourceDir, "mcp.yaml"), MANAGED);
  for (const name of ["a", "b"]) {
    write(join(sourceDir, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\nBody.\n`);
    write(join(sourceDir, "raw", "devin", "notes", `${name}.md`), `Note ${name}.\n`);
  }
  for (const reserved of ["config.json", "config.local.json", "mcp_config.local.json"]) {
    write(join(sourceDir, "raw", "devin", reserved), '{ "mcpServers": { "personal": { "command": "evil" } } }\n');
  }
  const targetDir = platformConfigDir("devin", destBase, userHome);
  write(join(targetDir, "skills", "mine", "SKILL.md"), "---\nname: mine\ndescription: m\n---\nMine.\n");
  write(join(targetDir, "mcp_config.json"), USER_MCP);
  write(join(targetDir, "config.json"), USER_CONFIG);
  write(join(targetDir, "mcp_config.local.json"), LOCAL_MCP);
  const options = {
    sourceDir,
    outputDir: join(sourceDir, "generated"),
    destBase,
    userHome,
    platforms: ["devin"] as const,
    rebuild: true,
    installSkills: false,
    installExtensions: false,
    logger: silentLogger,
  };
  const manifest = () =>
    JSON.parse(read(join(targetDir, ".ulis-manifest.json"))) as {
      skills: string[];
      rootEntries: string[];
      mcpServers: string[];
    };
  const servers = () => JSON.parse(read(join(targetDir, "mcp_config.json"))).mcpServers as Record<string, any>;
  const removeFromSource = () => {
    rmSync(join(sourceDir, "skills", "b"), { recursive: true });
    rmSync(join(sourceDir, "raw", "devin", "notes", "b.md"));
    write(join(sourceDir, "mcp.yaml"), "servers: {}\n");
  };
  return { sourceDir, targetDir, options, manifest, servers, removeFromSource };
}

describe.each([
  ["global", true],
  ["project", false],
])("runInstall devin %s", (_scope, global) => {
  it("installs skills and merges MCP servers, keeping unmanaged ones and Devin-owned files", async () => {
    const { targetDir, options, manifest, servers } = devinSource(global);
    await runInstall(options);
    expect(read(join(targetDir, "skills", "a", "SKILL.md"))).toContain("name: a");
    expect(servers()).toEqual({
      ...USER_SERVER,
      managed: { command: "server", env: { KEY: "${env:KEY}" } },
    });
    expect(manifest().mcpServers).toEqual(["managed"]);
    expect(manifest().rootEntries).toEqual(["notes/a.md", "notes/b.md"]);
    expect(existsSync(join(targetDir, "config.local.json"))).toBe(false);
    expect(read(join(targetDir, "config.json"))).toBe(USER_CONFIG);
    expect(read(join(targetDir, "mcp_config.local.json"))).toBe(LOCAL_MCP);
  });

  it("prunes stale managed skills, root entries and MCP servers and keeps unmanaged ones", async () => {
    const { targetDir, options, manifest, servers, removeFromSource } = devinSource(global);
    await runInstall(options);
    write(join(targetDir, "notes", "mine.md"), "Mine.\n");
    removeFromSource();
    await runInstall(options);
    expect(existsSync(join(targetDir, "skills", "b"))).toBe(false);
    expect(existsSync(join(targetDir, "notes", "b.md"))).toBe(false);
    expect(read(join(targetDir, "notes", "mine.md"))).toBe("Mine.\n");
    expect(read(join(targetDir, "skills", "mine", "SKILL.md"))).toContain("Mine.");
    expect(servers()).toEqual(USER_SERVER);
    expect(manifest().mcpServers).toEqual([]);
    expect(read(join(targetDir, "config.json"))).toBe(USER_CONFIG);
    expect(read(join(targetDir, "mcp_config.local.json"))).toBe(LOCAL_MCP);
  });

  it("keeps stale entries with prune off", async () => {
    const { targetDir, options, servers, removeFromSource } = devinSource(global);
    await runInstall(options);
    removeFromSource();
    await runInstall({ ...options, prune: false });
    expect(existsSync(join(targetDir, "skills", "b", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, "notes", "b.md"))).toBe(true);
    expect(Object.keys(servers()).sort()).toEqual(["managed", "user"]);
  });

  it("keeps a commented mcp_config.json byte-identical when the merge changes nothing", async () => {
    const { sourceDir, targetDir, options } = devinSource(global);
    write(join(sourceDir, "mcp.yaml"), "servers: {}\n");
    await runInstall(options);
    expect(read(join(targetDir, "mcp_config.json"))).toBe(USER_MCP);
  });

  it("warns when a merge rewrites a commented mcp_config.json", async () => {
    const { options, servers } = devinSource(global);
    const warnings: string[] = [];
    await runInstall({ ...options, logger: { ...silentLogger, warn: (message: string) => warnings.push(message) } });
    expect(servers().user).toEqual(USER_SERVER.user);
    expect(warnings.some((message) => message.includes("mcp_config.json: rewritten without its comments"))).toBe(true);
  });

  it("warns about lost MCP comments even when a later copy fails", async () => {
    const { sourceDir, targetDir, options } = devinSource(global);
    write(join(sourceDir, "raw", "devin", "notes", "c.md"), "Note c.\n");
    write(join(targetDir, "notes", "c.md", "keep.txt"), "in the way\n");
    const warnings: string[] = [];
    const logger = { ...silentLogger, warn: (message: string) => warnings.push(message) };
    await expect(runInstall({ ...options, logger })).rejects.toThrow();
    expect(read(join(targetDir, "mcp_config.json"))).not.toBe(USER_MCP);
    expect(warnings.some((message) => message.includes("mcp_config.json: rewritten without its comments"))).toBe(true);
  });

  it("merges a commented raw mcp_config.json fragment", async () => {
    const { sourceDir, options, servers } = devinSource(global);
    write(
      join(sourceDir, "raw", "devin", "mcp_config.json"),
      '{\n  // Devin-only\n  "mcpServers": { "managed": { "disabledTools": ["x"] } }\n}\n',
    );
    await runInstall(options);
    expect(servers().managed).toEqual({ command: "server", env: { KEY: "${env:KEY}" }, disabledTools: ["x"] });
  });

  it("clears only the stale entry in the copy's way when a copy fails", async () => {
    const { sourceDir, targetDir, options, servers, removeFromSource } = devinSource(global);
    write(join(sourceDir, "raw", "devin", "extra", "old.md"), "Old.\n");
    await runInstall(options);
    removeFromSource();
    rmSync(join(sourceDir, "raw", "devin", "extra"), { recursive: true });
    write(join(sourceDir, "raw", "devin", "extra"), "Now a file.\n");
    write(join(sourceDir, "raw", "devin", "notes", "c.md"), "Note c.\n");
    write(join(targetDir, "notes", "c.md", "keep.txt"), "in the way\n");
    await expect(runInstall(options)).rejects.toThrow();
    expect(existsSync(join(targetDir, "notes", "b.md"))).toBe(true);
    expect(existsSync(join(targetDir, "skills", "b", "SKILL.md"))).toBe(true);
    expect(Object.keys(servers()).sort()).toEqual(["managed", "user"]);
    expect(existsSync(join(targetDir, "extra", "old.md"))).toBe(false);
    expect(read(join(targetDir, "notes", "c.md", "keep.txt"))).toBe("in the way\n");
    expect(read(join(targetDir, "skills", "mine", "SKILL.md"))).toContain("Mine.");
    expect(read(join(targetDir, "config.json"))).toBe(USER_CONFIG);
  });
});
