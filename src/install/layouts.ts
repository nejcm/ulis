import type { Platform } from "../platforms.js";

export interface ManagedPlatformLayout {
  readonly nativeRoot: readonly string[];
  readonly agentDirectories: readonly string[];
  readonly agentExtension: string;
  /** Agent directories an older ULIS wrote; accepted in a previous manifest so the next install can prune them. */
  readonly legacyAgentDirectories?: readonly string[];
}

export const MANAGED_PLATFORM_LAYOUTS: Readonly<Record<Platform, ManagedPlatformLayout>> = {
  claude: { nativeRoot: [], agentDirectories: [""], agentExtension: ".md" },
  codex: { nativeRoot: [], agentDirectories: [""], agentExtension: ".toml" },
  cursor: { nativeRoot: [], agentDirectories: [""], agentExtension: ".mdc" },
  opencode: {
    nativeRoot: [],
    agentDirectories: [""],
    agentExtension: ".md",
    legacyAgentDirectories: ["core", "specialized"],
  },
  forgecode: { nativeRoot: [".forge"], agentDirectories: [""], agentExtension: ".md" },
};
