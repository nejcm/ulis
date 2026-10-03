import { describe, expect, it } from "bun:test";

import { parse } from "smol-toml";

import {
  configValuesEqual,
  mergeConfigValues,
  patchTomlOverlay,
  readMergeableConfig,
  writeMergeableConfig,
} from "./config-merge.js";

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

it("merges dates and other non-plain objects atomically", () => {
  class Value {
    constructor(readonly value: number) {}
  }
  for (const value of [new Date(), parse("expiry = 2026-10-02T00:00:00Z").expiry, new Value(1), new Map([["a", 1]])]) {
    expect(mergeConfigValues({ value }, { value })).toEqual({ value });
    expect((mergeConfigValues({ value }, { value }) as { value: unknown }).value).toBe(value);
    expect(mergeConfigValues({ value }, { value: { replaced: true } })).toEqual({ value: { replaced: true } });
  }
  expect(mergeConfigValues(Object.assign(Object.create(null), { keep: true }), { added: true })).toEqual({
    keep: true,
    added: true,
  });
});

it("compares TOML dates by type and offset inside objects and arrays", () => {
  const offset = parse("value = 2026-10-02T00:00:00Z").value;
  for (const value of ["2026-10-02T00:00:00", "2026-10-02", "2026-10-02T08:00:00+08:00"]) {
    const local = parse(`value = ${value}`).value;
    expect(configValuesEqual({ dates: [offset] }, { dates: [local] })).toBe(false);
  }
  expect(configValuesEqual({ value: offset }, parse("value = 2026-10-02T00:00:00Z"))).toBe(true);
  expect(configValuesEqual({ value: new Map([["a", 1]]) }, { value: new Map([["a", 2]]) })).toBe(false);
});

it("patches changed TOML dates in inline values and nested arrays of tables", () => {
  const existing =
    "array = [2026-10-02T00:00:00Z] # Keep array\ninline = { expiry = 2026-10-02T00:00:00Z } # Keep inline\n[[groups]]\n[[groups.entries]]\nexpiry = 2026-10-02T00:00:00Z\n[[groups]]\n[[groups.entries]]\nexpiry = 2026-10-02T00:00:00Z\n";
  const generated = existing.replaceAll("2026-10-02T00:00:00Z", "2026-10-02");
  const merged = parse(generated);
  const patched = patchTomlOverlay(existing, generated, merged);
  expect(configValuesEqual(parse(patched), merged)).toBe(true);
  expect(patched).toContain("# Keep array");
  expect(patched).toContain("# Keep inline");
  expect(patchTomlOverlay(patched, generated, merged)).toBe(patched);
});

it("patches an array that is both reordered and shortened", () => {
  const existing = '[tui]\nstatus_line = ["a", "b", "c", "d", "e", "f", "g"]\nkeep = true\n';
  const generated = '[tui]\nstatus_line = ["a", "b", "g", "e", "f"]\n';
  const merged = { tui: { status_line: ["a", "b", "g", "e", "f"], keep: true } };
  const patched = patchTomlOverlay(existing, generated, merged);
  expect(configValuesEqual(parse(patched), merged)).toBe(true);
});
