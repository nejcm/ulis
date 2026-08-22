import { expect, it } from "bun:test";

import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

import { toTomlMultilineString, toTomlString, toYamlString } from "./format.js";

it.each([
  ["NUL", "\u0000"],
  ["CR", "\r"],
  ["ESC", "\u001b"],
  ["DEL", "\u007f"],
])("toTomlString round-trips %s byte-for-byte", (_label, value) => {
  const parsed = parseToml(`value = ${toTomlString(value)}`) as Record<string, unknown>;
  expect(parsed.value).toBe(value);
});

it("toYamlString escapes C1 controls and round-trips them", () => {
  const value = "\u007f\u0085\u009f";
  const encoded = toYamlString(value);

  expect(encoded).not.toMatch(/[\u007f-\u009f]/u);
  expect(parseYaml(`value: ${encoded}`)).toEqual({ value });
});

it.each([
  ["composite", `\nline """\r\nslash: \\ and sequence: \\n\r\ntrailing slash\\\n`],
  ["one trailing quote", `body"`],
  ["two trailing quotes", `body""`],
  ["four quotes", `""""`],
  ["five quotes", `"""""`],
  ["six quotes", `""""""`],
  ["seven quotes", `"""""""`],
  ["NUL", "\u0000"],
  ["SOH", "\u0001"],
  ["BEL", "\u0007"],
  ["ESC", "\u001b"],
  ["FF", "\u000c"],
  ["DEL", "\u007f"],
  ["lone CR", "\r"],
  ["trailing CR", "body\r"],
])("round-trips %s byte-for-byte without extra TOML keys", (_label, value) => {
  const parsed = parseToml(`value = ${toTomlMultilineString(value)}`) as Record<string, unknown>;

  expect(Object.keys(parsed)).toEqual(["value"]);
  expect(parsed.value).toBe(value);
});

// A YAML 1.1 reader (PyYAML, Ruby Psych) breaks lines on LS and PS as well as LF; the `yaml`
// reader here is 1.2 and does not, so mapping the separators onto newlines models the stricter
// one — a surviving literal would become the live line it would have been.
it.each([
  ["LS", "\u2028"],
  ["PS", "\u2029"],
])("toYamlString cannot open a key through %s", (_label, separator) => {
  const value = `short${separator}mcp_servers:\n  pwn:\n    command: sh`;
  const encoded = toYamlString(value);

  expect(encoded).not.toMatch(/[\u2028\u2029]/u);
  const document = `description: ${encoded}`.replaceAll("\u2028", "\n").replaceAll("\u2029", "\n");
  const parsed = parseYaml(document) as Record<string, unknown>;
  expect(Object.keys(parsed)).toEqual(["description"]);
  expect(parsed.description).toBe(value);
});

// TOML has no such hazard: its only newlines are LF and CRLF, so a literal separator inside a
// basic string stays an ordinary character. Asserted rather than assumed, so a reader that ever
// disagrees fails here instead of silently widening `toTomlString`.
it.each([
  ["LS", "\u2028"],
  ["PS", "\u2029"],
])("toTomlString needs no %s escaping", (_label, separator) => {
  const value = `short${separator}[mcp_servers.pwn]`;
  const parsed = parseToml(`value = ${toTomlString(value)}`) as Record<string, unknown>;

  expect(Object.keys(parsed)).toEqual(["value"]);
  expect(parsed.value).toBe(value);
});
