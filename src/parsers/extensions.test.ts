import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { createTempRoot, writeTextFile } from "../test-utils/fs.js";
import { loadExtensions, mergeExtensionsConfigs } from "./extensions.js";

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
  it("concatenates platform extensions in input order", () => {
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

  it("ignores empty entries while preserving populated ones", () => {
    expect(
      mergeExtensionsConfigs([{ codex: { extensions: [] } }, { codex: { extensions: [{ name: "real" }] } }]),
    ).toEqual({
      codex: { extensions: [{ name: "real" }] },
    });
  });
});
