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
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
