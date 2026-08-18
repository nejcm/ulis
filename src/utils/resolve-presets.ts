import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Logger } from "../build.js";
import { ULIS_PRESETS_DIRNAME, ULIS_SOURCE_DIRNAME } from "../config.js";
import { confirm } from "./prompt.js";
import { hasUnredactableCredential, urlAuthorities } from "./redact.js";
import { fetchRemoteSource, isRemoteSource } from "./remote-source.js";

export interface ResolvedPreset {
  readonly name: string;
  readonly dir: string;
  /** Set when the preset was cloned from a git URL. Credential-free, for logging. */
  readonly remoteUrl?: string;
}

export interface ResolvedPresets {
  readonly presets: readonly ResolvedPreset[];
  /** Removes any cloned directories. A no-op when nothing was cloned. */
  readonly cleanup: () => void;
}

export interface ResolvePresetsOptions {
  readonly nonInteractive?: boolean;
  readonly onMissing?: "prompt" | "skip" | "error";
  /** Test hook: override default ~/.ulis/presets root. */
  readonly presetsRoot?: string;
  /** Test hook: override default bundled presets root. */
  readonly bundledPresetsRoot?: string;
  /** Progress logger for a remote clone. */
  readonly logger?: Logger;
  /** Abort a remote clone. */
  readonly signal?: AbortSignal;
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

/**
 * True when a `scheme://` authority is anything other than a plain host we can safely split on
 * commas. A comma or whitespace there can only be userinfo (hostnames hold neither), and an empty
 * authority (`https:///…`) pushes the credential into what looks like a path. Splitting any of
 * those tears a credential into a fragment that no longer looks like userinfo, so redaction misses
 * it and half a password reaches a log line.
 */
function hasUnsplittableAuthority(entry: string): boolean {
  return hasUnredactableCredential(entry) || urlAuthorities(entry).some((authority) => authority.includes(","));
}

/**
 * Parse a comma-separated preset string or array into individual names.
 */
export function parsePresetNames(raw: string | readonly string[]): readonly string[] {
  const list = Array.isArray(raw) ? (raw as string[]) : [raw as string];
  for (const entry of list) {
    if (hasUnsplittableAuthority(entry)) {
      // Deliberately echoes nothing: the entry may hold a password in a shape no redactor can be
      // guaranteed to recognise, and a vague message beats one that prints a credential.
      throw new Error(
        "A preset URL must have a plain host, with no comma or whitespace before the path. " +
          "Percent-encode a comma in credentials as %2C. The URL is not shown here because it may " +
          "contain a password.",
      );
    }
  }
  return list.flatMap((entry) => entry.split(",").map((s) => s.trim())).filter(Boolean);
}

/**
 * Resolve preset names to user-global or bundled preset directories.
 * Missing presets can be handled by prompting, skipping, or throwing.
 */
export async function resolvePresets(
  names: readonly string[],
  options: ResolvePresetsOptions = {},
): Promise<ResolvedPresets> {
  const cleanups: (() => void)[] = [];
  const cleanup = () => {
    while (cleanups.length > 0) cleanups.pop()!();
  };
  if (names.length === 0) return { presets: [], cleanup };

  const userRoot = userPresetsRoot(options.presetsRoot);
  const bundledRoot = bundledPresetsRoot(options.bundledPresetsRoot);
  const roots = [userRoot, bundledRoot];
  const missingBehavior = options.onMissing ?? (options.nonInteractive ? "error" : "prompt");
  const resolved: ResolvedPreset[] = [];

  try {
    for (const name of names) {
      if (isRemoteSource(name)) {
        // `onMissing` does not apply to a URL: "continue without it" would silently change what
        // gets installed, so a clone failure is an error even when missing presets are skipped.
        const remote = await fetchRemoteSource(name, { logger: options.logger, signal: options.signal });
        cleanups.push(remote.cleanup);
        resolved.push({ name: remote.name, dir: remote.dir, remoteUrl: remote.url });
        continue;
      }

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
  } catch (error) {
    cleanup();
    throw error;
  }

  return { presets: resolved, cleanup };
}
