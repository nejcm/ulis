import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { constants, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
export const ULIS_CLI_ENTRY_ENV = "ULIS_CLI_ENTRY";

export const BUN_REQUIRED_MESSAGE = [
  "`ulis tui` requires Bun.",
  "OpenTUI's renderer uses a native library that is only available through Bun's FFI.",
  "Install Bun (https://bun.sh) and run `ulis tui` again, or use the non-interactive commands",
  "(`ulis build`, `ulis install`, `ulis preset`) which run on Node.",
].join("\n");

export interface BunLookupOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly platform?: NodeJS.Platform;
  readonly fileExists?: (path: string) => boolean;
  readonly probe?: (command: string) => boolean;
}

/**
 * Finds a usable `bun` executable.
 *
 * Checks `BUN_INSTALL`, the default `~/.bun` install location, and finally the
 * bare `bun` command on `PATH`.
 */
export function findBunExecutable(options: BunLookupOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? existsSync;
  const probe = options.probe ?? canRunBun;

  const binary = platform === "win32" ? "bun.exe" : "bun";
  const roots = [env.BUN_INSTALL, join(home, ".bun")].filter((root): root is string => Boolean(root));

  for (const root of roots) {
    const candidate = join(root, "bin", binary);
    if (fileExists(candidate) && probe(candidate)) return candidate;
  }

  return probe("bun") ? "bun" : undefined;
}

function canRunBun(command: string): boolean {
  try {
    const result: SpawnSyncReturns<Buffer> = spawnSync(command, ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32" && command === "bun",
    });
    return result.error == null && result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Resolves the TUI entrypoint that Bun should execute.
 *
 * Prefers the built `tui.js` emitted next to `cli.js`, and falls back to the
 * TypeScript source when running from the repository.
 */
export function resolveTuiEntrypoint(
  moduleDir: string = dirname(fileURLToPath(import.meta.url)),
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  const candidates = [
    join(moduleDir, "tui.js"),
    join(moduleDir, "..", "tui.js"),
    join(moduleDir, "tui.ts"),
    join(moduleDir, "..", "tui.ts"),
  ];
  return candidates.find((candidate) => fileExists(candidate));
}

export interface LaunchTuiOptions extends BunLookupOptions {
  readonly moduleDir?: string;
  readonly cliEntrypoint?: string;
  readonly spawnProcess?: typeof spawn;
  readonly onError?: (message: string) => void;
}

/**
 * Launches the TUI under Bun, forwarding stdio and termination signals, and
 * resolves with the child's exit code.
 */
export async function launchTuiWithBun(options: LaunchTuiOptions = {}): Promise<number> {
  const fileExists = options.fileExists ?? existsSync;
  const onError = options.onError ?? ((message: string) => console.error(message));

  const bun = findBunExecutable(options);
  if (bun == null) {
    onError(BUN_REQUIRED_MESSAGE);
    return 1;
  }

  const entrypoint = resolveTuiEntrypoint(options.moduleDir, fileExists);
  if (entrypoint == null) {
    onError("Could not locate the ULIS TUI entrypoint. Reinstall @nejcm/ulis and try again.");
    return 1;
  }

  const spawnFn = options.spawnProcess ?? spawn;
  const cliEntrypoint = options.cliEntrypoint ?? process.argv[1];
  const child = spawnFn(bun, [entrypoint], {
    stdio: "inherit",
    env: cliEntrypoint ? { ...process.env, [ULIS_CLI_ENTRY_ENV]: cliEntrypoint } : process.env,
    cwd: process.cwd(),
  });

  const forward = (signal: NodeJS.Signals) => () => {
    if (!child.killed) child.kill(signal);
  };
  const listeners = SIGNALS.map((signal) => [signal, forward(signal)] as const);
  for (const [signal, listener] of listeners) process.on(signal, listener);

  try {
    return await new Promise<number>((resolvePromise, rejectPromise) => {
      child.once("error", rejectPromise);
      child.once("exit", (code, signal) => {
        if (code != null) return resolvePromise(code);
        resolvePromise(signal == null ? 0 : 128 + constants.signals[signal]);
      });
    });
  } finally {
    for (const [signal, listener] of listeners) process.off(signal, listener);
  }
}
