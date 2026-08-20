import { describe, expect, it } from "bun:test";

import matter from "gray-matter";

import { serializeYamlFrontmatter } from "./yaml.js";

describe("serializeYamlFrontmatter", () => {
  it("round-trips nested YAML without allowing nested values to add structure", () => {
    const hostileKey = "hostile\n---\ninjected: true";
    const hostileValue = "Looks harmless\nreadonly: false\n---";
    const frontmatter = serializeYamlFrontmatter({
      "key needing: quotes": {
        nested: [
          {
            [hostileKey]: hostileValue,
            values: [true, 3.5, null, ["text", { "a: b": '"quoted"' }]],
          },
          [],
          {},
          undefined,
        ],
        emptyObject: {},
        emptyArray: [],
        nullable: null,
        omitted: undefined,
      },
      enabled: false,
      count: 0,
      omitted: undefined,
    });

    const parsed = matter(`${frontmatter}\n\nBody.`);
    expect(parsed.data).toEqual({
      "key needing: quotes": {
        nested: [
          {
            [hostileKey]: hostileValue,
            values: [true, 3.5, null, ["text", { "a: b": '"quoted"' }]],
          },
          [],
          {},
          null,
        ],
        emptyObject: {},
        emptyArray: [],
        nullable: null,
      },
      enabled: false,
      count: 0,
    });
    expect(parsed.content.trim()).toBe("Body.");
  });

  it("rejects cyclic YAML aliases without overflowing the stack", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => serializeYamlFrontmatter({ cyclic })).toThrow("Cannot serialize cyclic YAML frontmatter");
  });

  it("round-trips scalar edge cases without changing their types", () => {
    const date = new Date("2020-01-02T00:00:00.000Z");
    const strings = {
      trailingColon: "foo:",
      controls: "\u0000\u001f\u007f\u0085\u009f",
      loneSurrogate: "a\ud800b",
      zero: "0",
      integer: "123",
      octal: "0123",
      sexagesimal: "12:30:00",
      exponent: "1e3",
      decimal: ".5",
      nan: ".nan",
      infinity: ".inf",
      boolean: "yes",
    };
    const frontmatter = serializeYamlFrontmatter({
      ...strings,
      date,
      number: 123,
      negativeZero: -0,
      nanNumber: Number.NaN,
      infinityNumber: Number.POSITIVE_INFINITY,
      negativeInfinityNumber: Number.NEGATIVE_INFINITY,
    });

    expect(frontmatter).not.toMatch(/[\u007f-\u009f]/u);
    const parsed = matter(frontmatter).data;
    expect(parsed).toMatchObject({
      ...strings,
      date: date.toISOString(),
      number: 123,
      negativeZero: 0,
      infinityNumber: Number.POSITIVE_INFINITY,
      negativeInfinityNumber: Number.NEGATIVE_INFINITY,
    });
    expect(Number.isNaN(parsed.nanNumber)).toBe(true);
  });

  it("rejects values YAML cannot represent faithfully", () => {
    expect(() => serializeYamlFrontmatter({ value: 1n })).toThrow("Cannot serialize bigint YAML frontmatter value");
    expect(() => serializeYamlFrontmatter({ value: new Map() })).toThrow(
      "Cannot serialize non-plain YAML frontmatter value",
    );
  });

  it("rejects frontmatter deeper than 100 levels", () => {
    const data: Record<string, unknown> = {};
    let nested = data;
    for (let depth = 0; depth < 101; depth++) {
      const next: Record<string, unknown> = {};
      nested.next = next;
      nested = next;
    }

    expect(() => serializeYamlFrontmatter(data)).toThrow("Cannot serialize YAML frontmatter deeper than 100 levels");
  });
});
