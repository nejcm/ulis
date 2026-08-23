import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Bun scopes a module's top-level hooks to whichever test file first evaluates the module, not to
// every importer, so a module-scope `afterEach` here would clean up after exactly one of the 12
// consuming test files and leak a temp root per test in the other 11. Every consumer must call
// cleanupTempRoots from its own literal afterEach instead.
const tmpRoots: string[] = [];

export function createTempRoot(prefix = "ulis-test-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

export function cleanupTempRoots(): void {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

export function readTextFile(path: string): string {
  return readFileSync(path, "utf-8");
}

export function writeTextFile(path: string, content = ""): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}
