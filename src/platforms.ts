import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const PLATFORMS = ["opencode", "claude", "codex", "cursor", "forgecode"] as const;

export type Platform = (typeof PLATFORMS)[number];

/**
 * Per-OS path segment relative to the destination base (`userHome` for global, project root for local).
 * Keys are `process.platform` values (`win32`, `linux`, `darwin`, …). Use `default` when several OSes share the same path.
 */
export type OsDirMap = Partial<Record<NodeJS.Platform, string>> & { default?: string };

/** Single relative path for every OS, or an OS-keyed map (see {@link OsDirMap}). */
export type PlatformDirSegment = string | OsDirMap;

export type PlatformDirsEntry = {
  home: PlatformDirSegment;
  project: PlatformDirSegment;
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  forgecode: "ForgeCode",
};

export const PLATFORM_DESCRIPTIONS: Record<Platform, string> = {
  opencode: "Generate the OpenCode workspace config and optional runtime files.",
  claude: "Generate Claude Code agents, commands, rules, and settings.",
  codex: "Generate Codex config, agents, and skill metadata.",
  cursor: "Generate Cursor agents, MCP config, and skill directories.",
  forgecode: "Generate ForgeCode agents, skills, MCP config, and project rules.",
};

export const PLATFORM_DIRS: Record<Platform, PlatformDirsEntry> = {
  claude: { home: ".claude", project: ".claude" },
  opencode: {
    home: {
      win32: ".config/opencode",
      linux: "opencode",
      darwin: "opencode",
      default: "opencode",
    },
    project: ".opencode",
  },
  codex: { home: ".codex", project: ".codex" },
  cursor: { home: ".cursor", project: ".cursor" },
  forgecode: { home: ".forge", project: ".forge" },
};

export function resolvePlatformDirSegment(segment: PlatformDirSegment): string {
  if (typeof segment === "string") return segment;
  const plat = process.platform as NodeJS.Platform;
  const dir = segment[plat] ?? segment.default;
  if (dir == null || dir === "") {
    throw new Error(`PLATFORM_DIRS: no path for platform "${process.platform}" and no default`);
  }
  return dir;
}

/**
 * Check whether a raw string maps to a supported platform id.
 */
export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/**
 * Return platforms in canonical order with duplicates removed.
 */
export function uniquePlatforms(values: readonly Platform[]): Platform[] {
  const selected = new Set(values);
  return PLATFORMS.filter((platform) => selected.has(platform));
}

/**
 * Parse comma-delimited platform CLI input and validate platform ids.
 */
export function parsePlatformList(rawValues: readonly string[]): Platform[] {
  const parsedValues = rawValues.flatMap((value) =>
    value
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );

  const invalid = parsedValues.filter((value) => !isPlatform(value));
  if (invalid.length > 0) {
    throw new Error(`Unknown platform(s): ${invalid.join(", ")}`);
  }

  return uniquePlatforms(parsedValues as Platform[]);
}

/**
 * Resolve the target config directory for a platform in home vs project mode.
 */
export function platformConfigDir(platform: Platform, destBase: string, userHome: string = homedir()): string {
  const entry = PLATFORM_DIRS[platform];
  const segment = isSamePath(destBase, userHome)
    ? resolvePlatformDirSegment(entry.home)
    : resolvePlatformDirSegment(entry.project);
  return join(destBase, segment);
}

/**
 * Compare filesystem paths in a platform-safe way.
 */
export function isSamePath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}
