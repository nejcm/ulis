import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
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
  const rulesDir = global ? join(userHome, ".devin", "rules") : join(targetDir, "rules");
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
      globalRulesEntries?: string[];
      mcpServers: string[];
    };
  const ownedRules = () =>
    global ? manifest().globalRulesEntries : manifest().rootEntries.filter((e) => e.startsWith("rules/"));
  const servers = () => JSON.parse(read(join(targetDir, "mcp_config.json"))).mcpServers as Record<string, any>;
  const removeFromSource = () => {
    rmSync(join(sourceDir, "skills", "b"), { recursive: true });
    rmSync(join(sourceDir, "raw", "devin", "notes", "b.md"));
    write(join(sourceDir, "mcp.yaml"), "servers: {}\n");
  };
  return { sourceDir, targetDir, rulesDir, userHome, options, manifest, ownedRules, servers, removeFromSource };
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

  it("installs rules, prunes stale managed ones and keeps unmanaged ones", async () => {
    const { sourceDir, rulesDir, options, manifest, ownedRules } = devinSource(global);
    write(join(sourceDir, "rules", "go", "style.md"), "---\npaths: ['**/*.go']\n---\nUse gofmt.\n");
    write(join(sourceDir, "rules", "old.md"), "Old.\n");
    write(join(rulesDir, "mine.md"), "Mine.\n");
    await runInstall(options);
    expect(read(join(rulesDir, "go-style.md"))).toBe('---\ntrigger: glob\nglobs:\n  - "**/*.go"\n---\n\nUse gofmt.\n');
    expect(manifest().rootEntries.filter((entry) => entry.startsWith("notes/"))).toEqual(["notes/a.md", "notes/b.md"]);
    expect(ownedRules()).toEqual(["rules/go-style.md", "rules/old.md"]);
    rmSync(join(sourceDir, "rules", "old.md"));
    await runInstall(options);
    expect(existsSync(join(rulesDir, "old.md"))).toBe(false);
    expect(existsSync(join(rulesDir, "go-style.md"))).toBe(true);
    expect(read(join(rulesDir, "mine.md"))).toBe("Mine.\n");
  });

  it("keeps stale rules with prune off", async () => {
    const { sourceDir, rulesDir, options, ownedRules } = devinSource(global);
    write(join(sourceDir, "rules", "old.md"), "Old.\n");
    await runInstall(options);
    rmSync(join(sourceDir, "rules", "old.md"));
    await runInstall({ ...options, prune: false });
    expect(existsSync(join(rulesDir, "old.md"))).toBe(true);
    expect(ownedRules()).toEqual([]);
  });

  it("never writes or claims a raw global_rules.md", async () => {
    const { sourceDir, targetDir, options, manifest } = devinSource(global);
    write(join(sourceDir, "raw", "devin", "global_rules.md"), "Raw.\n");
    write(join(targetDir, "global_rules.md"), "Mine.\n");
    await runInstall(options);
    expect(read(join(targetDir, "global_rules.md"))).toBe("Mine.\n");
    expect(manifest().rootEntries).not.toContain("global_rules.md");
  });
});

describe("runInstall devin global rules", () => {
  it("writes only ~/.devin/rules, leaving the rest of ~/.devin and ~/.config/devin/rules alone", async () => {
    const { sourceDir, targetDir, userHome, options } = devinSource(true);
    const devinHome = join(userHome, ".devin");
    write(join(sourceDir, "rules", "style.md"), "Style.\n");
    write(join(devinHome, "global_rules.md"), "Mine.\n");
    write(join(devinHome, "state", "app.json"), "{}\n");
    await runInstall(options);
    expect(readdirSync(devinHome).sort()).toEqual(["global_rules.md", "rules", "state"]);
    expect(readdirSync(join(devinHome, "rules"))).toEqual(["style.md"]);
    expect(readdirSync(join(devinHome, "state"))).toEqual(["app.json"]);
    expect(read(join(devinHome, "state", "app.json"))).toBe("{}\n");
    expect(read(join(devinHome, "global_rules.md"))).toBe("Mine.\n");
    expect(existsSync(join(targetDir, "rules"))).toBe(false);
  });

  it("leaves the first pass's prune unrun when the rules pass fails", async () => {
    const { sourceDir, targetDir, userHome, options, manifest, servers, removeFromSource } = devinSource(true);
    write(join(sourceDir, "rules", "a.md"), "A.\n");
    await runInstall(options);
    removeFromSource();
    write(join(sourceDir, "rules", "c.md"), "C.\n");
    write(join(userHome, ".devin", "rules", "c.md", "keep.txt"), "in the way\n");
    await expect(runInstall(options)).rejects.toThrow();
    expect(existsSync(join(targetDir, "notes", "b.md"))).toBe(true);
    expect(existsSync(join(targetDir, "skills", "b", "SKILL.md"))).toBe(true);
    expect(Object.keys(servers()).sort()).toEqual(["managed", "user"]);
    expect(read(join(userHome, ".devin", "rules", "c.md", "keep.txt"))).toBe("in the way\n");
    expect(manifest().globalRulesEntries).toContain("rules/a.md");
  });

  it("leaves a Phase 1 config-root rule unmanaged and keeps the same-named user rule in ~/.devin/rules", async () => {
    const { targetDir, userHome, options, manifest } = devinSource(true);
    await runInstall(options);
    const legacy = manifest();
    write(
      join(targetDir, ".ulis-manifest.json"),
      JSON.stringify({
        ...legacy,
        globalRulesEntries: undefined,
        rootEntries: [...legacy.rootEntries, "rules/mine.md"],
      }),
    );
    write(join(targetDir, "rules", "mine.md"), "Managed.\n");
    write(join(userHome, ".devin", "rules", "mine.md"), "Mine.\n");
    await runInstall(options);
    expect(read(join(targetDir, "rules", "mine.md"))).toBe("Managed.\n");
    expect(manifest().rootEntries).not.toContain("rules/mine.md");
    expect(read(join(userHome, ".devin", "rules", "mine.md"))).toBe("Mine.\n");
  });

  it.each([
    ["is the config dir", ""],
    ["sits inside the config dir", "local-state"],
  ])("refuses before writing when ~/.devin %s", async (_case, inside) => {
    const { sourceDir, targetDir, userHome, options, manifest } = devinSource(true);
    write(join(sourceDir, "rules", "mine.md"), "New.\n");
    await runInstall(options);
    const before = JSON.stringify(manifest());
    rmSync(join(userHome, ".devin"), { recursive: true });
    mkdirSync(join(targetDir, inside), { recursive: true });
    symlinkSync(join(targetDir, inside), join(userHome, ".devin"));
    write(join(sourceDir, "rules", "other.md"), "Other.\n");
    await expect(runInstall(options)).rejects.toThrow("overlaps the Devin config directory");
    expect(JSON.stringify(manifest())).toBe(before);
    expect(existsSync(join(targetDir, inside, "rules", "other.md"))).toBe(false);
  });

  it.each([
    ["with generated rules", true],
    ["with only stale rules to prune", false],
  ])("refuses a symlinked ~/.devin/rules %s", async (_case, withRules) => {
    const { sourceDir, userHome, options } = devinSource(true);
    const state = join(userHome, ".devin", "state");
    write(join(sourceDir, "rules", "old.md"), "Old.\n");
    await runInstall(options);
    rmSync(join(userHome, ".devin", "rules"), { recursive: true });
    write(join(state, "old.md"), "App data.\n");
    symlinkSync(state, join(userHome, ".devin", "rules"));
    if (!withRules) rmSync(join(sourceDir, "rules"), { recursive: true });
    await expect(runInstall(options)).rejects.toThrow("Unsafe Devin rules directory");
    expect(readdirSync(state)).toEqual(["old.md"]);
    expect(read(join(state, "old.md"))).toBe("App data.\n");
  });

  it.each([
    ["an existing", false],
    ["no", true],
  ])(
    "backs up ~/.devin/rules beside the config backup, not inside ~/.devin, with %s ~/.config",
    async (_case, noConfig) => {
      const { sourceDir, targetDir, userHome, options } = devinSource(true);
      if (noConfig) rmSync(join(targetDir, ".."), { recursive: true });
      write(join(sourceDir, "rules", "style.md"), "Style.\n");
      write(join(userHome, ".devin", "rules", "mine.md"), "Mine.\n");
      await runInstall({ ...options, backup: true });
      expect(readdirSync(join(userHome, ".devin"))).toEqual(["rules"]);
      const backups = readdirSync(join(targetDir, "..")).filter((name) => name.startsWith("devin-rules."));
      expect(backups).toHaveLength(1);
      expect(read(join(targetDir, "..", backups[0]!, "mine.md"))).toBe("Mine.\n");
    },
  );

  it("records a newly copied rule when the install fails after copying it", async () => {
    const { sourceDir, targetDir, options, manifest } = devinSource(true);
    write(join(sourceDir, "rules", "fresh.md"), "Fresh.\n");
    const success = (message: string) => {
      if (message === "fresh.md") throw new Error("logger failed");
    };
    await expect(runInstall({ ...options, logger: { ...silentLogger, success } })).rejects.toThrow("logger failed");
    expect(manifest().globalRulesEntries).toEqual(["rules/fresh.md"]);
    expect(manifest().rootEntries.some((entry) => entry.startsWith("rules/"))).toBe(false);
    expect(existsSync(join(targetDir, "rules"))).toBe(false);
  });

  it("refuses a manifest whose global rules entry points outside rules/", async () => {
    const { targetDir, options, manifest } = devinSource(true);
    await runInstall(options);
    write(
      join(targetDir, ".ulis-manifest.json"),
      JSON.stringify({ ...manifest(), globalRulesEntries: ["state/app.json"] }),
    );
    await expect(runInstall(options)).rejects.toThrow("Unsafe Devin rules entry");
  });

  it("refuses a dangling ~/.devin link into the config dir before writing", async () => {
    const { sourceDir, targetDir, userHome, options, manifest } = devinSource(true);
    await runInstall(options);
    const before = JSON.stringify(manifest());
    rmSync(join(userHome, ".devin"), { recursive: true, force: true });
    symlinkSync(join(targetDir, "local-state"), join(userHome, ".devin"));
    write(join(sourceDir, "raw", "devin", "local-state", "marker.txt"), "Marker.\n");
    write(join(sourceDir, "rules", "mine.md"), "New.\n");
    await expect(runInstall(options)).rejects.toThrow("dangling symbolic link");
    expect(JSON.stringify(manifest())).toBe(before);
    expect(existsSync(join(targetDir, "local-state"))).toBe(false);
  });

  it("refuses a case-variant rules directory before writing anything", async () => {
    const { sourceDir, targetDir, options } = devinSource(true);
    write(join(sourceDir, "raw", "devin", "Rules", "Mixed.md"), "Mixed.\n");
    await expect(runInstall(options)).rejects.toThrow('must be a real directory named "rules"');
    expect(existsSync(join(targetDir, ".ulis-manifest.json"))).toBe(false);
    expect(existsSync(join(targetDir, "skills", "a"))).toBe(false);
  });

  it("refuses a symlinked generated rules directory on --skip-rebuild", async () => {
    const { sourceDir, options } = devinSource(true);
    write(join(sourceDir, "rules", "a.md"), "A.\n");
    await runInstall(options);
    const generatedRules = join(options.outputDir, "devin", "rules");
    const elsewhere = join(sourceDir, "elsewhere");
    write(join(elsewhere, "x.md"), "X.\n");
    rmSync(generatedRules, { recursive: true });
    symlinkSync(elsewhere, generatedRules);
    await expect(runInstall({ ...options, rebuild: false })).rejects.toThrow('must be a real directory named "rules"');
  });
});
