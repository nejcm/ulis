import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";

import { BUN_REQUIRED_MESSAGE, findBunExecutable, launchTuiWithBun, resolveTuiEntrypoint } from "./launcher.js";

const never = () => false;

/** Minimal `ChildProcess` stand-in that only needs to emit `exit`/`error`. */
class FakeChild extends EventEmitter {
  killed = false;
  readonly signals: string[] = [];
  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.signals.push(String(signal));
    return true;
  }
}

function fakeSpawn(child: FakeChild, calls: { command?: string; args?: readonly string[]; env?: NodeJS.ProcessEnv }) {
  return ((command: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
    calls.command = command;
    calls.args = args;
    calls.env = options.env;
    return child;
  }) as never;
}

describe("findBunExecutable", () => {
  it("prefers BUN_INSTALL over the default home location", () => {
    const found = findBunExecutable({
      env: { BUN_INSTALL: "/opt/bun" },
      home: "/home/dev",
      platform: "linux",
      fileExists: (path) => path === join("/opt/bun", "bin", "bun"),
      probe: (command) => command === join("/opt/bun", "bin", "bun"),
    });
    expect(found).toBe(join("/opt/bun", "bin", "bun"));
  });

  it("falls back to ~/.bun/bin", () => {
    const expected = join("/home/dev", ".bun", "bin", "bun");
    const found = findBunExecutable({
      env: {},
      home: "/home/dev",
      platform: "linux",
      fileExists: (path) => path === expected,
      probe: (command) => command === expected,
    });
    expect(found).toBe(expected);
  });

  it("uses the Windows executable name on win32", () => {
    const expected = join("C:\\Users\\dev", ".bun", "bin", "bun.exe");
    const found = findBunExecutable({
      env: {},
      home: "C:\\Users\\dev",
      platform: "win32",
      fileExists: (path) => path === expected,
      probe: (command) => command === expected,
    });
    expect(found).toBe(expected);
  });

  it("falls back to bun on PATH when no install root matches", () => {
    const found = findBunExecutable({
      env: {},
      home: "/home/dev",
      platform: "linux",
      fileExists: never,
      probe: (command) => command === "bun",
    });
    expect(found).toBe("bun");
  });

  it("skips a stale install candidate and falls back to Bun on PATH", () => {
    const stale = join("/opt/bun", "bin", "bun");
    const found = findBunExecutable({
      env: { BUN_INSTALL: "/opt/bun" },
      home: "/home/dev",
      platform: "linux",
      fileExists: (path) => path === stale,
      probe: (command) => command === "bun",
    });
    expect(found).toBe("bun");
  });

  it("returns undefined when Bun is missing everywhere", () => {
    expect(findBunExecutable({ env: {}, home: "/home/dev", platform: "linux", fileExists: never, probe: never })).toBe(
      undefined,
    );
  });
});

describe("resolveTuiEntrypoint", () => {
  it("prefers the built entrypoint next to cli.js", () => {
    const dist = join("/app", "dist");
    const resolved = resolveTuiEntrypoint(
      dist,
      (path) => path === join(dist, "tui.js") || path === join(dist, "tui.ts"),
    );
    expect(resolved).toBe(join(dist, "tui.js"));
  });

  it("falls back to the TypeScript source when running from the repository", () => {
    const dir = join("/repo", "src", "tui");
    const resolved = resolveTuiEntrypoint(dir, (path) => path === join(dir, "..", "tui.ts"));
    expect(resolved).toBe(join(dir, "..", "tui.ts"));
  });

  it("returns undefined when nothing resolves", () => {
    expect(resolveTuiEntrypoint("/nowhere", never)).toBe(undefined);
  });
});

describe("launchTuiWithBun", () => {
  const bunOptions = {
    env: {},
    home: "/home/dev",
    platform: "linux" as const,
    probe: (command: string) => command === "bun",
  };

  it("reports a helpful error and exits non-zero when Bun is missing", async () => {
    const errors: string[] = [];
    const code = await launchTuiWithBun({
      ...bunOptions,
      probe: never,
      fileExists: never,
      onError: (message) => errors.push(message),
    });

    expect(code).toBe(1);
    expect(errors).toEqual([BUN_REQUIRED_MESSAGE]);
    expect(errors[0]).toContain("requires Bun");
  });

  it("errors when the TUI entrypoint cannot be found", async () => {
    const errors: string[] = [];
    const code = await launchTuiWithBun({
      ...bunOptions,
      fileExists: never,
      onError: (message) => errors.push(message),
    });

    expect(code).toBe(1);
    expect(errors[0]).toContain("Could not locate the ULIS TUI entrypoint");
  });

  it("spawns Bun with the resolved entrypoint and propagates the exit code", async () => {
    const child = new FakeChild();
    const calls: { command?: string; args?: readonly string[]; env?: NodeJS.ProcessEnv } = {};
    const entry = join("/app", "dist", "tui.js");
    const cliEntry = join("/app", "dist", "cli.js");

    const pending = launchTuiWithBun({
      ...bunOptions,
      moduleDir: join("/app", "dist"),
      cliEntrypoint: cliEntry,
      fileExists: (path) => path === entry,
      spawnProcess: fakeSpawn(child, calls),
    });

    child.emit("exit", 3, null);
    expect(await pending).toBe(3);
    expect(calls.command).toBe("bun");
    expect(calls.args).toEqual([entry]);
    expect(calls.env?.ULIS_CLI_ENTRY).toBe(cliEntry);
  });

  for (const [signal, exitCode] of [
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    it(`maps ${signal} termination to exit code ${exitCode}`, async () => {
      const child = new FakeChild();
      const entry = join("/app", "dist", "tui.js");

      const pending = launchTuiWithBun({
        ...bunOptions,
        moduleDir: join("/app", "dist"),
        fileExists: (path) => path === entry,
        spawnProcess: fakeSpawn(child, {}),
      });

      child.emit("exit", null, signal);
      expect(await pending).toBe(exitCode);
    });
  }

  it("removes its signal listeners once the child exits", async () => {
    const child = new FakeChild();
    const entry = join("/app", "dist", "tui.js");
    const before = process.listenerCount("SIGINT");

    const pending = launchTuiWithBun({
      ...bunOptions,
      moduleDir: join("/app", "dist"),
      fileExists: (path) => path === entry,
      spawnProcess: fakeSpawn(child, {}),
    });

    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    child.emit("exit", 0, null);
    await pending;
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

describe("Node CLI isolation", () => {
  it("keeps OpenTUI imports out of the Node command graph", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const root = join(import.meta.dir, "..");

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(root);

    const opentuiImporters = files
      .filter((file) => /from\s+"@opentui\/core/u.test(readFileSync(file, "utf-8")))
      .map((file) => file.slice(root.length + 1).replaceAll("\\", "/"));

    // Only the Bun-only TUI entrypoint and its renderer modules may touch
    // OpenTUI. Nothing in the Node command graph may.
    const allowed = (file: string) => file === "tui.ts" || file.startsWith("tui/");
    for (const file of opentuiImporters) {
      expect(allowed(file)).toBe(true);
    }
    expect(opentuiImporters).toContain("tui.ts");
  });

  it("loads the TUI entrypoint lazily so `ulis build` never evaluates it", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(join(import.meta.dir, "..", "commands", "tui.ts"), "utf-8");

    // A computed specifier keeps esbuild from inlining the TUI into dist/cli.js.
    expect(source).toContain("await import(pathToFileURL(entrypoint).href)");
    expect(source).not.toMatch(/^import .*from "\.\.\/tui\.js"/mu);
  });

  it("emits a dist/cli.js bundle with no OpenTUI reference", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const bundle = join(import.meta.dir, "..", "..", "dist", "cli.js");
    if (!existsSync(bundle)) return; // dist is only present after `bun run build`.

    expect(readFileSync(bundle, "utf-8")).not.toContain("@opentui/core");
  });
});
