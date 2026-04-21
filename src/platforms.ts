import { homedir } from "node:os";
import { join } from "node:path";

export const PLATFORMS = ["opencode", "claude", "codex", "cursor", "forgecode"] as const;

export type Platform = (typeof PLATFORMS)[number];

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

export const PLATFORM_DIRS: Record<Platform, { home: string; project: string }> = {
  claude: { home: ".claude", project: ".claude" },
  opencode: { home: ".opencode", project: ".opencode" },
  codex: { home: ".codex", project: ".codex" },
  cursor: { home: ".cursor", project: ".cursor" },
  forgecode: { home: "forge", project: ".forge" },
};

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

export function uniquePlatforms(values: readonly Platform[]): Platform[] {
  const selected = new Set(values);
  return PLATFORMS.filter((platform) => selected.has(platform));
}

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

export function platformConfigDir(platform: Platform, destBase: string, userHome: string = homedir()): string {
  const dirName = destBase === userHome ? PLATFORM_DIRS[platform].home : PLATFORM_DIRS[platform].project;
  return join(destBase, dirName);
}
