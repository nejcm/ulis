import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { ULIS_PRESETS_DIRNAME, ULIS_SOURCE_DIRNAME } from "../config.js";

export interface ResolvedPreset {
  readonly name: string;
  readonly dir: string;
}

export interface ResolvePresetsOptions {
  readonly nonInteractive?: boolean;
  readonly onMissing?: "prompt" | "skip" | "error";
  /** Test hook: override default ~/.ulis/presets root. */
  readonly presetsRoot?: string;
  /** Test hook: override default bundled presets root. */
  readonly bundledPresetsRoot?: string;
}

export function userPresetsRoot(override?: string): string {
  return override ?? join(homedir(), ULIS_SOURCE_DIRNAME, ULIS_PRESETS_DIRNAME);
}

export function bundledPresetsRoot(override?: string): string {
  if (override) return override;
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  // Support both local development and packaged CLI:
  // - src/utils/* -> src/assets/presets
  // - dist/cli.js -> dist/presets
  const candidates = [join(currentDir, "..", "assets", "presets"), join(currentDir, "presets")];
  return candidates.find((candidate) => isDirectory(candidate)) ?? candidates[0]!;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function listPresetDirectories(root: string): readonly string[] {
  if (!isDirectory(root)) return [];
  try {
    return readdirSync(root).filter((entry) => isDirectory(join(root, entry)));
  } catch {
    return [];
  }
}

export function resolvePresetDir(name: string, roots: readonly string[]): string | undefined {
  for (const root of roots) {
    const dir = join(root, name);
    if (isDirectory(dir)) return dir;
  }
  return undefined;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Parse a comma-separated preset string or array into individual names.
 */
export function parsePresetNames(raw: string | readonly string[]): readonly string[] {
  const list = Array.isArray(raw) ? (raw as string[]) : [raw as string];
  return list.flatMap((entry) => entry.split(",").map((s) => s.trim())).filter(Boolean);
}

/**
 * Resolve preset names to user-global or bundled preset directories.
 * Missing presets can be handled by prompting, skipping, or throwing.
 */
export async function resolvePresets(
  names: readonly string[],
  options: ResolvePresetsOptions = {},
): Promise<readonly ResolvedPreset[]> {
  if (names.length === 0) return [];

  const userRoot = userPresetsRoot(options.presetsRoot);
  const bundledRoot = bundledPresetsRoot(options.bundledPresetsRoot);
  const roots = [userRoot, bundledRoot];
  const missingBehavior = options.onMissing ?? (options.nonInteractive ? "error" : "prompt");
  const resolved: ResolvedPreset[] = [];

  for (const name of names) {
    const dir = resolvePresetDir(name, roots);
    if (dir != null) {
      resolved.push({ name, dir });
      continue;
    }

    const missingMessage = `Preset "${name}" not found in ${roots.join(" or ")}.`;
    if (missingBehavior === "skip") {
      continue;
    }
    if (missingBehavior === "error") {
      throw new Error(missingMessage);
    }

    const continueWithoutPreset = await confirm(`${missingMessage} Continue without it?`);
    if (!continueWithoutPreset) {
      throw new Error(`${missingMessage} Aborting.`);
    }
  }

  return resolved;
}
