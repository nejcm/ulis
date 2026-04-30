import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const presetsSourceDir = resolve(join(import.meta.dirname, "..", "assets", "presets"));
const presetsOutputDir = resolve(join(import.meta.dirname, "../..", "dist", "presets"));

if (!existsSync(presetsSourceDir)) {
  throw new Error(`Bundled presets source not found: ${presetsSourceDir}`);
}

rmSync(presetsOutputDir, { recursive: true, force: true });
mkdirSync(presetsOutputDir, { recursive: true });
cpSync(presetsSourceDir, presetsOutputDir, { recursive: true });

console.log("  copied src/assets/presets -> dist/presets");
