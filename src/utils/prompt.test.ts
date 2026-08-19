import { describe, expect, it } from "bun:test";
import { join } from "node:path";
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

/**
 * A closed stdin (`ulis install < /dev/null`, a detached CI job) must decline. Before this was
 * handled, `rl.question` never settled: the process hung past every `finally`, so a temp clone and
 * its credentials survived and the run exited 0 having done nothing. Driven through a child
 * process because it is the real stdin that has to be at EOF; a hang fails the test by timing out.
 */
describe("confirm with a closed stdin", () => {
  it("declines instead of hanging", async () => {
    const promptModule = join(import.meta.dir, "prompt.ts");
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const { confirm } = await import(${JSON.stringify(promptModule)});` +
          `process.stdout.write("answer=" + (await confirm("Continue?")));`,
      ],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );

    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(stdout).toContain("answer=false");
  }, 15_000);
});
