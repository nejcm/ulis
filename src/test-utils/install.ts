import { rmSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "../build.js";
import { cleanupTempRoots, createTempRoot as createRoot, readTextFile, writeTextFile } from "./fs.js";

// Bun scopes a module's top-level hooks to whichever test file first evaluates the module, not to
// every importer, so a module-scope hook here would clean up after exactly one of the 13 install
// test files and leak a full generated install tree per test in the other 12. Each install test
// file tracks and rmSync's its own roots instead - see cleanupInstallTempRoots below, which every
// split file must call from its own literal afterEach.
const tmpRoots: string[] = [];

export function createTempRoot(): string {
  const root = createRoot("ulis-install-");
  tmpRoots.push(root);
  return root;
}

export function cleanupInstallTempRoots(): void {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  // `createRoot` also records the root in `fs.ts`'s own list, which nothing else here drains.
  cleanupTempRoots();
}

export const write = writeTextFile;
export const read = readTextFile;

export const silentLogger: Logger = {
  info() {},
  success() {},
  warn() {},
  error() {},
  dim() {},
  header() {},
};

export function createForgecodeOutput(outputDir: string): void {
  write(join(outputDir, "forgecode", "AGENTS.md"), "Forge global instructions.\n");
  write(join(outputDir, "forgecode", ".forge", ".mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2));
}

export async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for condition.");
}
