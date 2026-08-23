import { afterEach, describe, expect, it } from "bun:test";

import { __test } from "./install.js";
import { resolveRunner } from "./install/runner.js";
import { cleanupInstallTempRoots } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

describe("resolveRunner", () => {
  it("prefers the CLI flag over config and auto-detect", () => {
    expect(resolveRunner({ cliFlag: "bunx", configValue: "npx", hasCommand: () => true })).toBe("bunx");
    expect(resolveRunner({ cliFlag: "npx", configValue: "bunx", hasCommand: () => true })).toBe("npx");
  });

  it("falls back to config.yaml when no CLI flag is set", () => {
    expect(resolveRunner({ configValue: "bunx", hasCommand: () => false })).toBe("bunx");
    expect(resolveRunner({ configValue: "npx", hasCommand: () => true })).toBe("npx");
  });

  it("auto-detects bunx when present and falls back to npx otherwise", () => {
    expect(resolveRunner({ hasCommand: (cmd) => cmd === "bunx" })).toBe("bunx");
    expect(resolveRunner({ hasCommand: () => false })).toBe("npx");
  });
});
