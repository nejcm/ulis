import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";

import type { Platform } from "../platforms.js";
import {
  existingFileMode,
  mergeConfigValues,
  patchTomlOverlay,
  readMergeableConfig,
  serializeMergeableConfig,
  writeFileExclusively,
} from "./config-merge.js";
import { omitConfigPaths, pickConfigPaths, type ConfigPath } from "./config-paths.js";
import { readFile } from "./fs.js";
import { PRESERVED_NATIVE_CONFIGS } from "./preserved-native-configs.data.js";

interface PreservedNativeConfigLogger {
  success(message: string): void;
}

export interface PreservedNativeConfigContext {
  readonly outputDir: string;
  readonly destBase: string;
  readonly userHome: string;
}

export type Ownership = "file" | "paths";
export type OverlayMode = "json" | "toml";

export interface PreservedNativeConfigSpec {
  readonly platform: Platform;
  readonly label: string;
  /**
   * Every basename the destination file can have. Declared rather than derived from `targetPath`,
   * which needs a context and can vary by install mode. Required, so a new platform cannot be added
   * without saying which files it reads natively - {@link NATIVE_CONFIG_FILENAMES} is what the
   * remote-source trust preview checks a `raw/` fragment against, and a missing entry there means a
   * hook or an MCP server installs unannounced.
   */
  readonly names: readonly string[];
  readonly generatedPath: (context: PreservedNativeConfigContext) => string;
  readonly targetPath: (context: PreservedNativeConfigContext) => string;
  readonly preservedPaths: readonly ConfigPath[];
  /** Preserve the complete existing object as the base, taking precedence over `ownership`. */
  readonly overlay?: OverlayMode | ((context: PreservedNativeConfigContext) => OverlayMode | undefined);
  /**
   * Ownership model for the target file. May be a literal or context-derived:
   * - "file" (default): ULIS owns the whole file. `preservedPaths` are
   *    exceptions PICKED from the existing file and merged on top of the
   *    generated content (so user-owned keys like `hooks` survive).
   * - "paths": ULIS owns ONLY `preservedPaths`. Everything else in the existing
   *    file is preserved. Used for host-owned files such as `~/.claude.json`
   *    where ULIS contributes only `mcpServers` but Claude Code owns the rest
   *    (projects, plugins, theme, history, ...).
   */
  readonly ownership?: Ownership | ((context: PreservedNativeConfigContext) => Ownership);
}

export interface PreservedNativeConfigEntry {
  readonly label: string;
  readonly generatedPath: string;
  readonly targetPath: string;
  readonly preservedPaths: readonly ConfigPath[];
  readonly ownership?: Ownership;
  readonly overlay?: OverlayMode;
}

export interface CapturedPreservedNativeConfig extends PreservedNativeConfigEntry {
  readonly preservedConfig: unknown | undefined;
  readonly originalContent?: string;
}

/**
 * A native config path the install refuses to write. Named so the install path can surface the
 * message as-is: it tells the user which file is a symlink and what to do about it, and a generic
 * "failed to write preserved native config" wrapper would bury exactly the part that is actionable.
 */
export class UnsafeNativeConfigPathError extends Error {
  constructor(readonly targetPath: string) {
    super(
      `Refusing to write through a symbolic link: ${targetPath}. Remove it, or point it somewhere ULIS is installing to.`,
    );
    this.name = "UnsafeNativeConfigPathError";
  }
}

export class PreservedNativeConfigParseError extends Error {
  constructor(
    readonly targetPath: string,
    cause: unknown,
  ) {
    super(`Failed to parse existing native config at ${targetPath}`, { cause });
    this.name = "PreservedNativeConfigParseError";
  }
}

/**
 * Every basename a platform reads as its own native config. These files carry hooks, startup
 * commands and MCP server definitions, so a `raw/` fragment landing in one installs behaviour the
 * host agent later executes on its own — which is why the remote-source trust preview names them.
 * Derived from the table in `preserved-native-configs.data.ts` so adding a platform cannot silently reopen that hole.
 */
export const NATIVE_CONFIG_FILENAMES: ReadonlySet<string> = new Set(
  PRESERVED_NATIVE_CONFIGS.flatMap((spec) => spec.names),
);

export function nativeConfigFilenames(platform: Platform): ReadonlySet<string> {
  return new Set(PRESERVED_NATIVE_CONFIGS.filter((spec) => spec.platform === platform).flatMap((spec) => spec.names));
}

export function getPreservedNativeConfigEntries(
  platform: Platform,
  context: PreservedNativeConfigContext,
): readonly PreservedNativeConfigEntry[] {
  return PRESERVED_NATIVE_CONFIGS.filter((spec) => spec.platform === platform).map((spec) => {
    const rawOwnership = "ownership" in spec ? spec.ownership : undefined;
    const ownership: Ownership = typeof rawOwnership === "function" ? rawOwnership(context) : (rawOwnership ?? "file");
    const rawOverlay = "overlay" in spec ? spec.overlay : undefined;
    const overlay = typeof rawOverlay === "function" ? rawOverlay(context) : rawOverlay;
    return {
      label: spec.label,
      generatedPath: spec.generatedPath(context),
      targetPath: spec.targetPath(context),
      preservedPaths: spec.preservedPaths,
      ownership,
      ...(overlay ? { overlay } : {}),
    };
  });
}

export function capturePreservedNativeConfigs(
  platform: Platform,
  context: PreservedNativeConfigContext,
): readonly CapturedPreservedNativeConfig[] {
  return getPreservedNativeConfigEntries(platform, context).map((entry) => {
    const captured = capturePreservedConfig(entry);
    return { ...entry, ...captured };
  });
}

export function writePreservedNativeConfigs(
  entries: readonly CapturedPreservedNativeConfig[],
  logger?: PreservedNativeConfigLogger,
): void {
  for (const entry of entries) {
    writePreservedNativeConfig(entry, logger);
  }
}

function capturePreservedConfig(
  entry: PreservedNativeConfigEntry,
): Pick<CapturedPreservedNativeConfig, "preservedConfig" | "originalContent"> {
  if (!existsSync(entry.targetPath)) return { preservedConfig: undefined };

  try {
    const existing = readMergeableConfig(entry.targetPath);
    if (entry.overlay) {
      return {
        preservedConfig: existing,
        ...(entry.overlay === "toml" ? { originalContent: readFile(entry.targetPath) } : {}),
      };
    }

    const preserved =
      entry.ownership === "paths"
        ? omitConfigPaths(existing, entry.preservedPaths)
        : pickConfigPaths(existing, entry.preservedPaths);
    return {
      preservedConfig: Object.keys(preserved).length > 0 ? preserved : undefined,
    };
  } catch (error) {
    throw new PreservedNativeConfigParseError(entry.targetPath, error);
  }
}

/**
 * Write a native config file into the destination, never through a symbolic link.
 *
 * These are the platform's real config files - the MCP servers and hooks a host agent acts on - and
 * `writeFile` follows a link at the destination, so one planted at `opencode.json` or `.claude.json`
 * made the install write wherever it pointed, with content the planter already influences since the
 * existing file is what gets preserved and merged into the result. Remove-then-exclusive-create is
 * the same pair `src/install/fs.ts` uses: the link is unlinked as a link, and the create fails
 * rather than adopting anything that appears in between.
 */
function writeDestinationFile(filePath: string, content: string | Buffer, sourceMode?: number): void {
  refuseSymlinkAt(filePath);
  writeFileExclusively(filePath, content, sourceMode);
}

/**
 * {@link writeDestinationFile} for a verbatim copy. Reads the bytes and goes through the one writer
 * rather than `copyFileSync`, which needs its own exclusive-create flag and its own mode handling -
 * two implementations of the same rule is what keeps going wrong here. The source's mode is carried
 * across explicitly, since `copyFileSync` would have done that and a plain write would not.
 */
function copyDestinationFile(sourcePath: string, filePath: string): void {
  writeDestinationFile(filePath, readFileSync(sourcePath), existingFileMode(sourcePath));
}

/**
 * Refuse a symbolic link where a native config file belongs.
 *
 * Safety does not rest on this check: both writers above unlink and create exclusively, so neither
 * can follow a link whatever this reports. It exists to fail loudly and name the path, because a
 * link here is about as likely to be a dotfile manager's as an attacker's, and quietly replacing a
 * deliberate one is its own kind of data loss. That is also why an `lstat` which cannot answer is
 * simply left alone - the write below fails on the same error, so nothing is decided by the silence.
 */
function refuseSymlinkAt(filePath: string): void {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    return;
  }
  if (!stats.isSymbolicLink()) return;
  throw new UnsafeNativeConfigPathError(filePath);
}

function writePreservedNativeConfig(entry: CapturedPreservedNativeConfig, logger?: PreservedNativeConfigLogger): void {
  try {
    // Once, for every branch below, rather than at each of the ones that write. The branches that
    // do not write still act on the path - one of them deleted the link outright - and a refusal
    // that holds only where it was remembered is not a refusal. `existsSync` follows a link, so no
    // branch can be trusted to notice one on its own.
    refuseSymlinkAt(entry.targetPath);
    if (!existsSync(entry.generatedPath)) {
      if (entry.overlay && existsSync(entry.targetPath)) {
        logger?.success(`${entry.label} (preserved)`);
        return;
      }
      if (entry.preservedConfig !== undefined) {
        writeDestinationFile(entry.targetPath, serializeMergeableConfig(entry.targetPath, entry.preservedConfig));
        logger?.success(`${entry.label} (preserved)`);
      } else if (existsSync(entry.targetPath)) {
        removePath(entry.targetPath);
        logger?.success(`${entry.label} (removed)`);
      }
      return;
    }

    if (entry.preservedConfig === undefined) {
      copyDestinationFile(entry.generatedPath, entry.targetPath);
      logger?.success(`${entry.label} (copied)`);
      return;
    }

    const generatedContent = readFile(entry.generatedPath);
    const generated = readMergeableConfig(entry.generatedPath);
    const merged = mergeConfigValues(entry.preservedConfig, generated);
    if (entry.overlay === "toml") {
      const existingContent = entry.originalContent ?? readFile(entry.targetPath);
      writeDestinationFile(entry.targetPath, patchTomlOverlay(existingContent, generatedContent, merged));
    } else {
      writeDestinationFile(entry.targetPath, serializeMergeableConfig(entry.targetPath, merged));
    }
    logger?.success(`${entry.label} (merged)`);
  } catch (error) {
    // Passed through rather than wrapped: its message names the file and the fix, and this wrapper
    // would hide both behind the path pair.
    if (error instanceof UnsafeNativeConfigPathError) throw error;
    throw new Error(`Failed to merge preserved native config ${entry.generatedPath} -> ${entry.targetPath}`, {
      cause: error,
    });
  }
}

function removePath(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
