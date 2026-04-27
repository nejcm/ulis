import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

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
 * Resolve preset names to their directories under ~/.ulis/presets/.
 * Missing presets can be handled by prompting, skipping, or throwing.
 */
export async function resolvePresets(
  names: readonly string[],
  options: ResolvePresetsOptions = {},
): Promise<readonly ResolvedPreset[]> {
  if (names.length === 0) return [];

  const presetsRoot = options.presetsRoot ?? join(homedir(), ULIS_SOURCE_DIRNAME, ULIS_PRESETS_DIRNAME);
  const missingBehavior = options.onMissing ?? (options.nonInteractive ? "error" : "prompt");
  const resolved: ResolvedPreset[] = [];

  for (const name of names) {
    const dir = join(presetsRoot, name);
    if (existsSync(dir)) {
      resolved.push({ name, dir });
      continue;
    }

    if (missingBehavior === "skip") {
      continue;
    }
    if (missingBehavior === "error") {
      throw new Error(`Preset "${name}" not found in ${presetsRoot}.`);
    }

    const continueWithoutPreset = await confirm(`Preset "${name}" not found in ${presetsRoot}. Continue without it?`);
    if (!continueWithoutPreset) {
      throw new Error(`Preset "${name}" not found in ${presetsRoot}. Aborting.`);
    }
  }

  return resolved;
}
