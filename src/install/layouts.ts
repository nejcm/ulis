import type { Platform } from "../platforms.js";

export interface ManagedPlatformLayout {
  readonly nativeRoot: readonly string[];
  readonly agentDirectories: readonly string[];
  readonly agentExtension: string;
}

export const MANAGED_PLATFORM_LAYOUTS: Readonly<Record<Platform, ManagedPlatformLayout>> = {
  claude: { nativeRoot: [], agentDirectories: [""], agentExtension: ".md" },
  codex: { nativeRoot: [], agentDirectories: [""], agentExtension: ".toml" },
  cursor: { nativeRoot: [], agentDirectories: [""], agentExtension: ".mdc" },
  opencode: { nativeRoot: [], agentDirectories: ["core", "specialized"], agentExtension: ".md" },
  forgecode: { nativeRoot: [".forge"], agentDirectories: [""], agentExtension: ".md" },
};
