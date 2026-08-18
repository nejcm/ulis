import { describe, expect, it } from "bun:test";

import { assertShellSafeArgv, commandExists } from "./command.js";

describe("commandExists", () => {
  it("reports success as found and a non-zero exit as missing", () => {
    expect(commandExists("anything", () => ({ status: 0 }))).toBe(true);
    expect(commandExists("anything", () => ({ status: 1 }))).toBe(false);
  });
});

describe("assertShellSafeArgv", () => {
  it("allows the argv shapes a real skill or extension install uses", () => {
    expect(() =>
      assertShellSafeArgv(["npx", "skills@latest", "add", "@scope/pkg", "-a", "claude", "--project", "--yes"]),
    ).not.toThrow();
  });

  // The reason this guard exists: with `shell: true` Node concatenates argv instead of escaping it,
  // so cmd.exe reads the `&` as a separator and runs a second command the preview never showed.
  it.each([
    ["command separator", "pkg & calc"],
    ["pipe", "pkg | calc"],
    ["redirection", "pkg > out.txt"],
    ["variable expansion", "pkg %PATH%"],
    ["escape character", "pkg ^& calc"],
    ["newline", "pkg\ncalc"],
  ])("refuses a %s", (_label, token) => {
    expect(() => assertShellSafeArgv(["npx", token])).toThrow(/shell metacharacters/u);
  });

  // A spaced token is not a metacharacter but breaks the same promise: shell:true concatenates argv,
  // so it arrives as two arguments while the preview showed one quoted token.
  it("refuses an argument containing a space", () => {
    expect(() => assertShellSafeArgv(["npx", "--flag=a b"])).toThrow(/metacharacters or spaces/u);
  });

  it("does not echo raw control characters back into the error message", () => {
    const CR = String.fromCharCode(13);
    const ESC = String.fromCharCode(27);
    // The offending token is named in the error, so it has to be sanitized on the way out —
    // otherwise refusing the command would itself hand the attacker the terminal.
    let message = "";
    try {
      assertShellSafeArgv(["npx", `pkg${CR}${ESC}[2K`]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("shell metacharacters");
    expect(message).not.toContain(CR);
    expect(message).not.toContain(ESC);
  });
});
