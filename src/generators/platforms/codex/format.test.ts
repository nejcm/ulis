import { expect, it } from "bun:test";

import { parse as parseToml } from "smol-toml";

import { toTomlMultilineString } from "./format.js";

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
