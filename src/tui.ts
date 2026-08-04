import { createCliRenderer, CliRenderEvents } from "@opentui/core";

import { TuiController } from "./tui/controller.js";

/**
 * Start the interactive ULIS terminal UI.
 *
 * Requires Bun: OpenTUI's renderer is backed by a native library that is only
 * reachable through Bun's FFI. `commands/tui.ts` re-launches this module under
 * Bun when the CLI itself is running on Node.
 */
export async function runTui(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    targetFps: 30,
  });

  const controller = new TuiController(renderer);
  renderer.on(CliRenderEvents.RESIZE, () => controller.render());
  controller.render();
}

if (import.meta.main) {
  runTui().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start the ULIS TUI: ${message}`);
    process.exit(1);
  });
}
