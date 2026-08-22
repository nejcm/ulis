import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

/**
 * Ask a yes/no question on the terminal. Anything but `y`/`yes` is a no, so an empty answer
 * or a closed stdin declines rather than proceeds.
 *
 * There is no terminal check here. The remote-command gate is the only prompt that is a security
 * boundary, and it refuses a non-terminal stdin at its own seam in `install.ts` - loudly, because
 * a run that silently installed nothing and exited 0 reads as a successful one. A second check
 * here could only ever fail open, which is the shape that gate was rewritten to close.
 */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    // `rl.question` never settles when stdin reaches EOF (`ulis install < /dev/null`, a detached
    // CI job), which would hang the process past every `finally` — leaking a temp clone and its
    // credentials — and exit 0 having done nothing. Racing the answer against `close` is what makes
    // the documented "a closed stdin declines" true, while a piped answer still reads normally.
    // A rejected question (an aborted interface) declines for the same reason.
    const answered = rl.question(`${question} [y/N] `).then(
      (answer) => answer.trim().toLowerCase(),
      () => undefined,
    );
    const closed = new Promise<undefined>((resolveClosed) => rl.once("close", () => resolveClosed(undefined)));
    const answer = await Promise.race([answered, closed]);
    if (answer === undefined) output.write("\n");
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
