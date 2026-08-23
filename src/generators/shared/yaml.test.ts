import { describe, expect, it } from "bun:test";

import matter from "gray-matter";

import { partitionReservedExtras, serializeYamlFrontmatter, toYamlComment, toYamlScalar } from "./yaml.js";

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

describe("partitionReservedExtras", () => {
  it("drops a colliding extra and notes it, keeping the rest", () => {
    const { extras, notes } = partitionReservedExtras({ tools: "Bash", keep: 1, gone: undefined }, ["tools", "name"]);

    expect(extras).toEqual({ keep: 1 });
    expect(notes).toEqual(["ULIS dropped the platform field 'tools' because it collides with a generated field."]);
  });

  it("keeps a null extra, and drops it when it collides", () => {
    expect(partitionReservedExtras({ maybe: null }, []).extras).toEqual({ maybe: null });
    expect(partitionReservedExtras({ maybe: null }, ["maybe"]).extras).toEqual({});
  });
});

describe("toYamlComment", () => {
  it("keeps a note on one line whatever it carries", () => {
    const comment = toYamlComment("a\nhooks:\n  PreToolUse: []\u0085\u007f");

    expect(comment.includes("\n")).toBe(false);
    expect(comment).not.toMatch(/[\u007f-\u009f]/u);
    expect(comment.startsWith("# ")).toBe(true);
    const parsed = matter(`---\n${comment}\nname: kept\n---\n\nBody.\n`);
    expect(parsed.data).toEqual({ name: "kept" });
  });
});

// A YAML 1.1 reader (PyYAML, Ruby Psych) breaks lines on LS and PS as well as LF. The readers in
// this repo are 1.2 and do not, so re-parsing has to model the stricter one: mapping LS/PS onto
// newlines turns any surviving literal separator into the live line it would have been.
function asYaml11(document: string): string {
  return document.replaceAll("\u2028", "\n").replaceAll("\u2029", "\n");
}

describe("Unicode line separators", () => {
  const separators = ["\u2028", "\u2029"] as const;

  it("quotes and escapes a separator inside a scalar", () => {
    for (const separator of separators) {
      const value = `a${separator}hooks: evil`;
      expect(toYamlScalar(value)).not.toMatch(/[\u2028\u2029]/u);

      const document = serializeYamlFrontmatter({ description: value });
      expect(document).not.toMatch(/[\u2028\u2029]/u);
      const parsed = matter(`${asYaml11(document)}\n\nBody.\n`);
      expect(Object.keys(parsed.data)).toEqual(["description"]);
      expect(parsed.data.description).toBe(value);
    }
  });

  it("escapes a separator inside a comment", () => {
    for (const separator of separators) {
      const comment = toYamlComment(`dropped${separator}hooks: evil`);

      expect(comment).not.toMatch(/[\u2028\u2029]/u);
      const parsed = matter(asYaml11(`---\n${comment}\nname: kept\n---\n\nBody.\n`));
      expect(parsed.data).toEqual({ name: "kept" });
    }
  });
});
