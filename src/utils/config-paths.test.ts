import { describe, expect, it } from "bun:test";

import { omitConfigPaths, pickConfigPaths } from "./config-paths.js";

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
