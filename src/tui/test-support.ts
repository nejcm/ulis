// Shared harness for TuiController tests: builds a real renderer + controller pair. Lives under
// tui/ rather than test-utils/ because launcher.test.ts's Node-isolation check forbids anything
// outside tui/ from importing @opentui/core. Every controller.*.test.ts file that imports this
// must still call cleanupControllerRenderers from its own literal afterEach - see fs.ts's note on
// why a module-scope hook here would only attach to one of the several importing files under Bun.
import { join } from "node:path";

import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";

import { createTempRoot } from "../test-utils/fs.js";
import { TuiController, type TuiControllerOptions } from "./controller.js";

/** Comfortably above `key-codes.ts`'s 35 ms duplicate-key window. */
export const KEY_DELAY_MS = 60;

const activeRenderers: { destroy: () => void }[] = [];

export function preferencesPath(): string {
  const root = createTempRoot("ulis-tui-controller-");
  return join(root, ".ulis-tui.json");
}

export interface Harness extends TestRendererSetup {
  controller: TuiController;
  exitCodes: number[];
  frame: () => Promise<string>;
  press: (...keys: string[]) => Promise<void>;
}

export async function createHarness(
  width = 100,
  height = 30,
  options: Omit<TuiControllerOptions, "exit"> = {},
): Promise<Harness> {
  const setup = await createTestRenderer({ width, height });
  activeRenderers.push(setup.renderer);
  const exitCodes: number[] = [];
  const controller = new TuiController(setup.renderer, {
    exit: (code) => exitCodes.push(code),
    writeStderr: () => {},
    listPresets: () => [],
    preferencesPath: options.preferencesPath ?? preferencesPath(),
    ...options,
  });
  controller.render();
  await setup.renderOnce();

  const frame = async () => {
    controller.render();
    await setup.renderOnce();
    return setup.captureCharFrame();
  };
  const press = async (...keys: string[]) => {
    for (const key of keys) await setup.mockInput.pressKeys([key], KEY_DELAY_MS);
    controller.render();
    await setup.renderOnce();
  };

  return { ...setup, controller, exitCodes, frame, press };
}

/**
 * Destroys every renderer created via createHarness since the last call. Each test renderer
 * registers process-level listeners, so long runs need this drained every test or they trip
 * Node's max-listener warning - and a leaked renderer's spinner interval has previously survived
 * into an unrelated later file and broken it ("TextBuffer is destroyed"). Call from a literal
 * afterEach in every file that imports createHarness.
 */
export function cleanupControllerRenderers(): void {
  for (const renderer of activeRenderers.splice(0)) renderer.destroy();
}
