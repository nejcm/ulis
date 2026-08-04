import { pathToFileURL } from "node:url";

import { launchTuiWithBun, resolveTuiEntrypoint } from "../tui/launcher.js";

/**
 * Start the interactive terminal UI.
 *
 * Under Bun the TUI runs in-process. Under Node the OpenTUI renderer cannot
 * initialize, so the CLI re-launches the TUI entrypoint with Bun and mirrors its
 * exit status.
 */
export async function tuiCmd(): Promise<void> {
  if (process.versions.bun != null) {
    const entrypoint = resolveTuiEntrypoint();
    if (entrypoint == null) {
      console.error("Could not locate the ULIS TUI entrypoint. Reinstall @nejcm/ulis and try again.");
      process.exit(1);
    }
    // The specifier is computed so the bundler leaves it alone: `dist/cli.js`
    // must stay free of OpenTUI, which only loads under Bun.
    const mod = (await import(pathToFileURL(entrypoint).href)) as { runTui: () => Promise<void> };
    await mod.runTui();
    return;
  }

  const code = await launchTuiWithBun();
  if (code !== 0) process.exit(code);
}
