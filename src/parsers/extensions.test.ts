import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { cleanupTempRoots, createTempRoot, writeTextFile } from "../test-utils/fs.js";
import { loadExtensions, mergeExtensionsConfigs } from "./extensions.js";

afterEach(cleanupTempRoots);

describe("loadExtensions", () => {
  it("returns empty config when extensions.yaml is empty", () => {
    const dir = createTempRoot("ulis-extensions-");
    writeTextFile(join(dir, "extensions.yaml"), "# intentionally empty\n");

    expect(loadExtensions(dir)).toEqual({});
  });

  it("returns empty config when extensions.yaml is missing", () => {
    const dir = createTempRoot("ulis-extensions-");

    expect(loadExtensions(dir)).toEqual({});
  });

  it("parses a populated extensions.yaml", () => {
    const dir = createTempRoot("ulis-extensions-");
    writeTextFile(
      join(dir, "extensions.yaml"),
      [
        "codex:",
        "  extensions:",
        "    - key: supermemory",
        "      name: codex-supermemory@latest",
        "      args: [install]",
        '"*":',
        "  extensions: []",
        "",
      ].join("\n"),
    );

    expect(loadExtensions(dir)).toEqual({
      codex: {
        extensions: [{ key: "supermemory", name: "codex-supermemory@latest", args: ["install"] }],
      },
      "*": { extensions: [] },
    });
  });

  it("rejects entries with empty name", () => {
    const dir = createTempRoot("ulis-extensions-");
    writeTextFile(
      join(dir, "extensions.yaml"),
      ["codex:", "  extensions:", "    - name: ''", "      args: [install]", ""].join("\n"),
    );

    expect(() => loadExtensions(dir)).toThrow(/extensions/);
  });
});

describe("mergeExtensionsConfigs", () => {
  it("merges distinct platform extensions in input order", () => {
    expect(
      mergeExtensionsConfigs([
        {
          "*": { extensions: [{ name: "preset/all" }] },
          codex: { extensions: [{ name: "preset/codex" }] },
        },
        {
          "*": { extensions: [{ name: "base/all" }] },
          codex: { extensions: [{ name: "base/codex" }] },
        },
      ]),
    ).toEqual({
      "*": { extensions: [{ name: "preset/all" }, { name: "base/all" }] },
      codex: { extensions: [{ name: "preset/codex" }, { name: "base/codex" }] },
    });
  });

  it("lets a base entry override a preset entry of the same name (base-wins, not additive)", () => {
    const merged = mergeExtensionsConfigs([
      { codex: { extensions: [{ name: "shared-ext", args: ["--preset-arg"] }] } },
      { codex: { extensions: [{ name: "shared-ext", args: ["--base-arg"] }] } },
    ]);

    expect(merged.codex?.extensions).toEqual([{ name: "shared-ext", args: ["--base-arg"] }]);
  });

  it("keeps a preset entry that survives when the base declares a different name", () => {
    const merged = mergeExtensionsConfigs([
      { codex: { extensions: [{ name: "preset-only" }] } },
      { codex: { extensions: [{ name: "base-only" }] } },
    ]);

    expect(merged.codex?.extensions).toEqual([{ name: "preset-only" }, { name: "base-only" }]);
  });

  it("lets key distinguish two entries that share a name", () => {
    const merged = mergeExtensionsConfigs([
      {
        codex: {
          extensions: [
            { name: "pkg-ext", key: "pkg-ext/a", args: ["--flavor a"] },
            { name: "pkg-ext", key: "pkg-ext/b", args: ["--flavor b"] },
          ],
        },
      },
    ]);

    expect(merged.codex?.extensions).toEqual([
      { name: "pkg-ext", key: "pkg-ext/a", args: ["--flavor a"] },
      { name: "pkg-ext", key: "pkg-ext/b", args: ["--flavor b"] },
    ]);
  });

  it("deduplicates repeated entries within a single layer, last occurrence winning, first position kept", () => {
    const merged = mergeExtensionsConfigs([
      {
        codex: {
          extensions: [
            { name: "dup-ext", args: ["--first"] },
            { name: "other-ext" },
            { name: "dup-ext", args: ["--second"] },
          ],
        },
      },
    ]);

    expect(merged.codex?.extensions).toEqual([{ name: "dup-ext", args: ["--second"] }, { name: "other-ext" }]);
  });

  it("three layers: a middle preset's entry wins when the top layer doesn't declare it", () => {
    const merged = mergeExtensionsConfigs([
      { codex: { extensions: [{ name: "shared-ext", args: ["--a"] }] } },
      { codex: { extensions: [{ name: "shared-ext", args: ["--b"] }] } },
      { codex: { extensions: [{ name: "other-ext" }] } },
    ]);

    expect(merged.codex?.extensions).toEqual([{ name: "shared-ext", args: ["--b"] }, { name: "other-ext" }]);
  });

  it("preserves first-occurrence position across layers even when overridden later", () => {
    const merged = mergeExtensionsConfigs([
      { codex: { extensions: [{ name: "first-ext" }, { name: "shared-ext", args: ["--preset"] }] } },
      { codex: { extensions: [{ name: "shared-ext", args: ["--base"] }, { name: "last-ext" }] } },
    ]);

    expect(merged.codex?.extensions).toEqual([
      { name: "first-ext" },
      { name: "shared-ext", args: ["--base"] },
      { name: "last-ext" },
    ]);
  });

  it("merges the '*' platform key independently of a named platform key", () => {
    const merged = mergeExtensionsConfigs([
      { "*": { extensions: [{ name: "wildcard-ext" }] }, codex: { extensions: [{ name: "codex-only" }] } },
      { codex: { extensions: [{ name: "codex-only", args: ["--override"] }] } },
    ]);

    expect(merged).toEqual({
      "*": { extensions: [{ name: "wildcard-ext" }] },
      codex: { extensions: [{ name: "codex-only", args: ["--override"] }] },
    });
  });

  it("ignores empty entries while preserving populated ones", () => {
    expect(
      mergeExtensionsConfigs([{ codex: { extensions: [] } }, { codex: { extensions: [{ name: "real" }] } }]),
    ).toEqual({
      codex: { extensions: [{ name: "real" }] },
    });
  });
});
