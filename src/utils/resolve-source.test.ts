import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createTempRoot } from "../test-utils/fs.js";
import { resolveSource } from "./resolve-source.js";

describe("resolveSource", () => {
  it("uses an explicit source while keeping global installs pointed at home", () => {
    const root = createTempRoot("ulis-resolve-");
    const sourceDir = join(root, "example");
    mkdirSync(sourceDir, { recursive: true });

    expect(resolveSource({ cwd: root, source: "example", global: true })).toEqual({
      sourceDir,
      destBase: homedir(),
      mode: "global",
    });
  });

  it("installs alongside an explicit source when global mode is not set", () => {
    const root = createTempRoot("ulis-resolve-");
    const sourceDir = join(root, "example");
    mkdirSync(sourceDir, { recursive: true });

    expect(resolveSource({ cwd: root, source: "example" })).toEqual({
      sourceDir,
      destBase: root,
      mode: "source",
    });
  });

  it("uses the project-local .ulis source by default", () => {
    const root = createTempRoot("ulis-resolve-");
    const sourceDir = join(root, ".ulis");
    mkdirSync(sourceDir, { recursive: true });

    expect(resolveSource({ cwd: root })).toEqual({
      sourceDir,
      destBase: root,
      mode: "project",
    });
  });

  it("throws an init hint when the default project source is missing", () => {
    const root = createTempRoot("ulis-resolve-");

    expect(() => resolveSource({ cwd: root })).toThrow(
      `No .ulis/ folder in ${root}. Run 'ulis init' to scaffold one, or use '--global' / '--source <path>'.`,
    );
  });

  it("throws the resolved path when an explicit source is missing", () => {
    const root = createTempRoot("ulis-resolve-");
    const missing = join(root, "missing");

    expect(() => resolveSource({ cwd: root, source: "missing" })).toThrow(`--source path does not exist: ${missing}`);
  });
});
