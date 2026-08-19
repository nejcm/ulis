import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

/**
 * Ask a yes/no question on the terminal. Anything but `y`/`yes` is a no, so an empty answer
 * or a closed stdin declines rather than proceeds.
 *
 * `requireTty` is for prompts that are a security boundary rather than a convenience: without it,
 * `echo y | ulis install --source <url>` would answer the remote-command gate on the user's behalf.
 */
export async function confirm(question: string, options: { requireTty?: boolean } = {}): Promise<boolean> {
  if (options.requireTty && !input.isTTY) {
    output.write(`${question} [y/N] declined: stdin is not a terminal. Re-run with -y to accept.\n`);
    return false;
  }
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
