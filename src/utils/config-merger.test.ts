import { describe, expect, it } from "bun:test";

import { mergeConfigValues, readMergeableConfig, writeMergeableConfig } from "./config-merger.js";

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
