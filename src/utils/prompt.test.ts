import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { confirm } from "./prompt.js";

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
