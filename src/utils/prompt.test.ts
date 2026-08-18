import { describe, expect, it } from "bun:test";
import { stdin, stdout } from "node:process";

import { confirm } from "./prompt.js";

/**
 * The fail-closed leg of the remote-command trust gate. Without `requireTty`,
 * `echo y | ulis install --source <url>` answers the gate on the user's behalf, so this branch is
 * the security boundary — and the one most likely to be "simplified" away later.
 */
describe("confirm with requireTty", () => {
  it("declines without reading stdin when stdin is not a terminal", async () => {
    const wasTty = stdin.isTTY;
    const write = stdout.write.bind(stdout);
    const written: string[] = [];
    stdin.isTTY = false;
    stdout.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof stdout.write;

    try {
      // A pending read would hang this test rather than resolve, which is the assertion that
      // matters: nothing consumes the piped answer.
      expect(await confirm("Run these commands?", { requireTty: true })).toBe(false);
      expect(written.join("")).toContain("declined");
    } finally {
      stdout.write = write;
      stdin.isTTY = wasTty;
    }
  });
});
