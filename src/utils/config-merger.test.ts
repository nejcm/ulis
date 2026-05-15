import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { PLATFORMS } from "../platforms.js";
import {
  capturePreservedNativeConfigs,
  getPreservedNativeConfigEntries,
  mergeConfigValues,
  omitConfigPaths,
  pickConfigPaths,
  PreservedNativeConfigParseError,
  readMergeableConfig,
  writeMergeableConfig,
  writePreservedNativeConfigs,
  type CapturedPreservedNativeConfig,
} from "./config-merger.js";

const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-config-merger-"));
  tmpRoots.push(root);
  return root;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function entry(root: string, preservedConfig: unknown | undefined): CapturedPreservedNativeConfig {
  return {
    label: "config.json",
    generatedPath: join(root, "generated", "config.json"),
    targetPath: join(root, "target", "config.json"),
    preservedPaths: [["keep"]],
    preservedConfig,
  };
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("mergeConfigValues", () => {
  it("recursively merges objects and replaces arrays at the same path", () => {
    expect(
      mergeConfigValues(
        { generated: true, list: ["generated"], nested: { keep: true, replace: ["generated"] } },
        { raw: true, list: ["raw"], nested: { replace: ["raw"] } },
      ),
    ).toEqual({
      generated: true,
      raw: true,
      list: ["raw"],
      nested: { keep: true, replace: ["raw"] },
    });
  });

  it("replaces root-level non-object values", () => {
    expect(mergeConfigValues({ generated: true }, ["raw"])).toEqual(["raw"]);
    expect(mergeConfigValues(["generated"], "raw")).toBe("raw");
  });
});

describe("mergeable config helpers", () => {
  it("reject unsupported config extensions", () => {
    expect(() => readMergeableConfig("config.txt")).toThrow("Unsupported config extension");
    expect(() => writeMergeableConfig("config.txt", {})).toThrow("Unsupported config extension");
  });
});

describe("preserved native config registry", () => {
  const context = {
    outputDir: join("root", ".ulis", "generated"),
    destBase: join("root", "project"),
    userHome: join("root", "home"),
  };

  it("declares preserved config entries for every platform", () => {
    expect(PLATFORMS.flatMap((platform) => getPreservedNativeConfigEntries(platform, context))).toEqual([
      {
        label: "opencode.json",
        generatedPath: join("root", ".ulis", "generated", "opencode", "opencode.json"),
        targetPath: join("root", "project", ".opencode", "opencode.json"),
        preservedPaths: [["mcp"]],
        ownership: "file",
      },
      {
        label: "settings.json",
        generatedPath: join("root", ".ulis", "generated", "claude", "settings.json"),
        targetPath: join("root", "project", ".claude", "settings.json"),
        preservedPaths: [
          ["hooks"],
          ["statusLine"],
          ["enabledPlugins"],
          ["extraKnownMarketplaces"],
          ["autoUpdatesChannel"],
          ["agentPushNotifEnabled"],
          ["theme"],
        ],
        ownership: "file",
      },
      {
        label: ".claude.json / .mcp.json",
        generatedPath: join("root", ".ulis", "generated", "claude", ".claude.json"),
        targetPath: join("root", "project", ".mcp.json"),
        preservedPaths: [["mcpServers"]],
        // Project install: target is `<cwd>/.mcp.json`; ULIS merges with existing
        // mcpServers (file-owned mode).
        ownership: "file",
      },
      {
        label: "config.toml",
        generatedPath: join("root", ".ulis", "generated", "codex", "config.toml"),
        targetPath: join("root", "project", ".codex", "config.toml"),
        preservedPaths: [["projects"], ["hooks"], ["mcp_servers"], ["tui"], ["notice"], ["features"]],
        ownership: "file",
      },
      {
        label: "mcp.json",
        generatedPath: join("root", ".ulis", "generated", "cursor", "mcp.json"),
        targetPath: join("root", "project", ".cursor", "mcp.json"),
        preservedPaths: [["mcpServers"]],
        ownership: "file",
      },
      {
        label: ".mcp.json",
        generatedPath: join("root", ".ulis", "generated", "forgecode", ".forge", ".mcp.json"),
        targetPath: join("root", "project", ".forge", ".mcp.json"),
        preservedPaths: [["mcpServers"]],
        ownership: "file",
      },
      {
        label: ".forge.toml",
        generatedPath: join("root", ".ulis", "generated", "forgecode", ".forge.toml"),
        targetPath: join("root", "project", ".forge", ".forge.toml"),
        preservedPaths: [[]],
        ownership: "file",
      },
    ]);
  });

  it("switches Claude's .claude.json/.mcp.json entry to ownership: 'paths' for global installs", () => {
    // When destBase === userHome (global install), the target is `~/.claude.json`
    // — a file Claude Code owns. ULIS owns ONLY the `mcpServers` path; every
    // other key (theme, projects, plugins, history) must survive across installs.
    const globalContext = {
      outputDir: join("root", ".ulis", "generated"),
      destBase: join("root", "home"),
      userHome: join("root", "home"),
    };
    const claudeEntries = getPreservedNativeConfigEntries("claude", globalContext);
    const claudeJsonEntry = claudeEntries.find((entry) => entry.label === ".claude.json / .mcp.json");

    expect(claudeJsonEntry).toEqual({
      label: ".claude.json / .mcp.json",
      generatedPath: join("root", ".ulis", "generated", "claude", ".claude.json"),
      targetPath: join("root", "home", ".claude.json"),
      preservedPaths: [["mcpServers"]],
      ownership: "paths",
    });
  });
});

describe("pickConfigPaths", () => {
  it("copies only selected nested paths", () => {
    expect(
      pickConfigPaths(
        {
          keep: { nested: true, other: false },
          missingParent: "not-object",
          drop: true,
        },
        [
          ["keep", "nested"],
          ["missingParent", "child"],
        ],
      ),
    ).toEqual({ keep: { nested: true } });
  });

  it("copies the whole config for an empty path", () => {
    expect(pickConfigPaths({ keep: true, nested: { value: 1 } }, [[]])).toEqual({
      keep: true,
      nested: { value: 1 },
    });
  });
});

describe("omitConfigPaths", () => {
  it("returns the source with the listed top-level paths removed", () => {
    expect(omitConfigPaths({ theme: "dark", mcpServers: { a: 1 }, projects: { p: 1 } }, [["mcpServers"]])).toEqual({
      theme: "dark",
      projects: { p: 1 },
    });
  });

  it("removes nested paths without disturbing siblings", () => {
    expect(omitConfigPaths({ kept: { keep: true, drop: true, sibling: { v: 1 } } }, [["kept", "drop"]])).toEqual({
      kept: { keep: true, sibling: { v: 1 } },
    });
  });

  it("does not mutate the source object", () => {
    const source = { mcpServers: { existing: 1 }, theme: "dark" };
    omitConfigPaths(source, [["mcpServers"]]);
    expect(source).toEqual({ mcpServers: { existing: 1 }, theme: "dark" });
  });

  it("is a no-op for paths that don't exist", () => {
    expect(omitConfigPaths({ a: 1 }, [["missing"], ["a", "missing"]])).toEqual({ a: 1 });
  });

  it("returns an empty object when the empty path is requested", () => {
    expect(omitConfigPaths({ a: 1, b: 2 }, [[]])).toEqual({});
  });

  it("returns an empty object for non-object sources", () => {
    expect(omitConfigPaths(null, [["a"]])).toEqual({});
    expect(omitConfigPaths(42, [["a"]])).toEqual({});
  });
});

describe("capturePreservedNativeConfigs", () => {
  it("returns undefined preserved config when the target file is missing", () => {
    const root = createTempRoot();

    expect(
      capturePreservedNativeConfigs("opencode", {
        outputDir: join(root, ".ulis", "generated"),
        destBase: join(root, "project"),
        userHome: join(root, "home"),
      }),
    ).toEqual([
      {
        label: "opencode.json",
        generatedPath: join(root, ".ulis", "generated", "opencode", "opencode.json"),
        targetPath: join(root, "project", ".opencode", "opencode.json"),
        preservedPaths: [["mcp"]],
        preservedConfig: undefined,
        ownership: "file",
      },
    ]);
  });

  it("throws a typed parse error for malformed existing config", () => {
    const root = createTempRoot();
    const targetPath = join(root, "project", ".opencode", "opencode.json");
    write(targetPath, "{invalid");

    expect(() =>
      capturePreservedNativeConfigs("opencode", {
        outputDir: join(root, ".ulis", "generated"),
        destBase: join(root, "project"),
        userHome: join(root, "home"),
      }),
    ).toThrow(PreservedNativeConfigParseError);
  });
});

describe("writePreservedNativeConfigs", () => {
  it("writes preserved-only config when generated config is absent", () => {
    const root = createTempRoot();

    writePreservedNativeConfigs([entry(root, { keep: { existing: true } })]);

    expect(readJson(join(root, "target", "config.json"))).toEqual({ keep: { existing: true } });
  });

  it("removes stale target config when generated and preserved config are absent", () => {
    const root = createTempRoot();
    const targetPath = join(root, "target", "config.json");
    write(targetPath, JSON.stringify({ old: true }));

    writePreservedNativeConfigs([entry(root, undefined)]);

    expect(existsSync(targetPath)).toBe(false);
  });

  it("copies generated config when no preserved config exists", () => {
    const root = createTempRoot();
    const generatedPath = join(root, "generated", "config.json");
    write(generatedPath, JSON.stringify({ generated: true }));
    mkdirSync(join(root, "target"), { recursive: true });

    writePreservedNativeConfigs([entry(root, undefined)]);

    expect(readJson(join(root, "target", "config.json"))).toEqual({ generated: true });
  });

  it("merges preserved config with generated config taking precedence", () => {
    const root = createTempRoot();
    write(
      join(root, "generated", "config.json"),
      JSON.stringify({ keep: { shared: "generated", added: true }, generated: true }),
    );

    writePreservedNativeConfigs([entry(root, { keep: { shared: "existing", existing: true }, old: true })]);

    expect(readJson(join(root, "target", "config.json"))).toEqual({
      keep: { shared: "generated", existing: true, added: true },
      old: true,
      generated: true,
    });
  });

  it("keeps generated config when existing and raw config are absent", () => {
    const root = createTempRoot();
    write(join(root, "generated", "config.json"), JSON.stringify({ generated: true, list: ["generated"] }));

    writePreservedNativeConfigs([entry(root, undefined)]);

    expect(readJson(join(root, "target", "config.json"))).toEqual({ generated: true, list: ["generated"] });
  });

  it("merges existing preserved config with generated config when raw config is absent", () => {
    const root = createTempRoot();
    write(
      join(root, "generated", "config.json"),
      JSON.stringify({ keep: { shared: "generated", generatedOnly: true }, list: ["generated"] }),
    );

    writePreservedNativeConfigs([
      entry(root, { keep: { shared: "existing", existingOnly: true }, list: ["existing"], existing: true }),
    ]);

    expect(readJson(join(root, "target", "config.json"))).toEqual({
      keep: { shared: "generated", existingOnly: true, generatedOnly: true },
      list: ["generated"],
      existing: true,
    });
  });

  it("merges generated config with raw config when existing preserved config is absent", () => {
    const root = createTempRoot();
    const generated = {
      keep: { shared: "generated", generatedOnly: true },
      list: ["generated"],
      generated: true,
    };
    const raw = { keep: { shared: "raw", rawOnly: true }, list: ["raw"], raw: true };
    write(join(root, "generated", "config.json"), JSON.stringify(mergeConfigValues(generated, raw)));

    writePreservedNativeConfigs([entry(root, undefined)]);

    expect(readJson(join(root, "target", "config.json"))).toEqual({
      keep: { shared: "raw", generatedOnly: true, rawOnly: true },
      list: ["raw"],
      generated: true,
      raw: true,
    });
  });

  it("applies precedence existing preserved config then generated config then raw config", () => {
    const root = createTempRoot();
    const generated = {
      keep: { shared: "generated", generatedOnly: true },
      list: ["generated"],
      generated: true,
    };
    const raw = { keep: { shared: "raw", rawOnly: true }, list: ["raw"], raw: true };
    write(join(root, "generated", "config.json"), JSON.stringify(mergeConfigValues(generated, raw)));

    writePreservedNativeConfigs([
      entry(root, { keep: { shared: "existing", existingOnly: true }, list: ["existing"], existing: true }),
    ]);

    expect(readJson(join(root, "target", "config.json"))).toEqual({
      keep: { shared: "raw", existingOnly: true, generatedOnly: true, rawOnly: true },
      list: ["raw"],
      existing: true,
      generated: true,
      raw: true,
    });
  });
});
