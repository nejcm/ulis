import { constants } from "node:os";

import { createCliRenderer, CliRenderEvents, type CliRenderer } from "@opentui/core";

import { TuiController, type TuiControllerOptions } from "./tui/controller.js";
import { createInterruptGuard, type InterruptGuard } from "./utils/interrupt.js";

type RunTuiOptions = Omit<TuiControllerOptions, "interruptGuard"> & {
  readonly createRenderer?: () => Promise<CliRenderer>;
  readonly onController?: (controller: TuiController) => void;
};

/**
 * Start the interactive ULIS terminal UI.
 *
 * Requires Bun: OpenTUI's renderer is backed by a native library that is only
 * reachable through Bun's FFI. `commands/tui.ts` re-launches this module under
 * Bun when the CLI itself is running on Node.
 */
export async function runTui(options: RunTuiOptions = {}): Promise<void> {
  const { createRenderer, onController, ...controllerOptions } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let controller: TuiController | undefined;
  let interruptedCode: number | undefined;
  const guard: InterruptGuard = createInterruptGuard(true, (signal) => {
    const code = 128 + constants.signals[signal];
    interruptedCode = code;
    if (controller) {
      void controller.shutdown(code).catch(() => {
        // Shutdown is what turns the UI off and calls `exit`. If it rejects, nothing else will:
        // the process would stay alive with rendering already disabled.
        guard.release();
        exit(code);
      });
    } else {
      guard.release();
      exit(code);
    }
  });

  let renderer: CliRenderer;
  try {
    renderer = await (
      createRenderer ??
      (() =>
        createCliRenderer({
          exitOnCtrlC: false,
          useMouse: true,
          targetFps: 30,
          // OpenTUI would otherwise register its own handler for eight signals, including four the
          // guard does not own, and tear the renderer down underneath an in-flight shutdown. Its
          // `beforeExit` listener is registered separately, so a normal exit still restores the
          // terminal.
          exitSignals: [],
        }))
    )();
  } catch (error) {
    guard.release();
    if (interruptedCode != null) return;
    throw error;
  }

  if (interruptedCode != null) {
    try {
      renderer.destroy();
    } catch {}
    return;
  }

  controller = new TuiController(renderer, { ...controllerOptions, interruptGuard: guard });
  onController?.(controller);
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
