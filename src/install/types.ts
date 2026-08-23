import type { Logger } from "../build.js";
import type { Platform } from "../platforms.js";
import type { ExtensionsConfig, SkillsConfig } from "../schema.js";
import type { ResolvedPreset } from "../utils/resolve-presets.js";
import type { PreviewInputs } from "./preview.js";

export type Runner = "npx" | "bunx";

export interface InstallContext {
  readonly outputDir: string;
  readonly destBase: string;
  readonly userHome: string;
  readonly globalInstall: boolean;
  readonly backup: boolean;
  readonly prune: boolean;
  readonly timestamp: string;
  readonly extensions: ExtensionsConfig;
  readonly runner: Runner;
  readonly installExtensionsEnabled: boolean;
  readonly logger?: Logger;
}

export interface InstallOptions {
  readonly platforms?: readonly Platform[];
  /**
   * ulis source tree (e.g. `./.ulis/` or `~/.ulis/`).
   */
  readonly sourceDir: string;
  /**
   * What to show as the source in logs. Defaults to `sourceDir`; a remote source passes its URL so
   * the log names the repository rather than the throwaway temp directory.
   */
  readonly sourceLabel?: string;
  /** Redacted URLs of remote sources in this run; a non-empty list arms the trust gate. */
  readonly remoteSources?: readonly string[];
  /**
   * True when `sourceDir` is a tree this run cloned rather than one the user wrote. Set from the
   * resolver's own `mode` (identity), not from what the path looks like (naming) - every caller
   * passes it explicitly.
   */
  readonly sourceIsRemote?: boolean;
  /** `-y`: run a remote source's commands without prompting. */
  readonly nonInteractive?: boolean;
  /**
   * The exact command list a caller already showed the user and got consent for. Checked against
   * what this run actually plans; a mismatch aborts. Used by the TUI, whose review screen is the
   * consent boundary. Omit for a plain CLI run, which prompts instead.
   */
  readonly approvedCommands?: readonly string[];
  /**
   * Where the per-platform configs land — typically `~` for global, CWD for project.
   */
  readonly destBase: string;
  /**
   * Where the intermediate build output lives. Defaults to `<sourceDir>/generated/`.
   */
  readonly outputDir?: string;
  /** Install skills globally (`npx skills ... -g`) instead of project-local. */
  readonly globalInstall?: boolean;
  readonly backup?: boolean;
  /** Remove agents and local skills previously installed by ULIS but no longer generated. */
  readonly prune?: boolean;
  readonly rebuild?: boolean;
  readonly logger?: Logger;
  readonly userHome?: string;
  /** Resolved presets to merge at build time and for external skill installs. */
  readonly presets?: readonly ResolvedPreset[];
  /** Override the package runner used for `extensions.yaml` entries. */
  readonly runner?: Runner;
  /** When false, skip running extensions installers (`extensions.yaml`). */
  readonly installExtensions?: boolean;
  /** When false, skip installing external skills (`skills.yaml`). */
  readonly installSkills?: boolean;
  readonly signal?: AbortSignal;
}

export interface PresetInstallOptions {
  readonly platforms?: readonly Platform[];
  /** Presets to install as the complete source. Applied in order; later presets win conflicts. */
  readonly presets: readonly ResolvedPreset[];
  /** Where the per-platform configs land — typically `~` for global, CWD for project. */
  readonly destBase: string;
  /** Install skills globally (`npx skills ... -g`) instead of project-local. */
  readonly globalInstall?: boolean;
  readonly backup?: boolean;
  /** Remove agents and local skills previously installed by ULIS but no longer generated. */
  readonly prune?: boolean;
  readonly logger?: Logger;
  readonly userHome?: string;
  /** Override the package runner used for `extensions.yaml` entries. */
  readonly runner?: Runner;
  /** When false, skip running extensions installers (`extensions.yaml`). */
  readonly installExtensions?: boolean;
  /** When false, skip installing external skills (`skills.yaml`). */
  readonly installSkills?: boolean;
  /** Redacted URLs of remote presets in this run; a non-empty list arms the trust gate. */
  readonly remoteSources?: readonly string[];
  /** `-y`: run a remote preset's commands without prompting. */
  readonly nonInteractive?: boolean;
  /**
   * The exact command list a caller already showed the user and got consent for. Checked against
   * what this run actually plans; a mismatch aborts. Used by the TUI, whose review screen is the
   * consent boundary. Omit for a plain CLI run, which prompts instead.
   */
  readonly approvedCommands?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface AsyncCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

export type SkillInstallLog =
  | { readonly level: "success"; readonly message: string }
  | { readonly level: "warn"; readonly message: string; readonly name: string };

export interface GeneratedInstallOptions {
  readonly outputDir: string;
  readonly destBase: string;
  readonly userHome: string;
  readonly globalInstall: boolean;
  readonly backup: boolean;
  readonly prune: boolean;
  readonly platforms: readonly Platform[];
  readonly skillsConfig: SkillsConfig;
  readonly extensionsConfig: ExtensionsConfig;
  readonly runner: Runner;
  readonly installExtensionsEnabled: boolean;
  readonly installSkillsEnabled: boolean;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
  /**
   * What this run installs from, for the trust preview to generate and read back. Not the merged
   * configs above: the preview has to see the same inputs the build sees, or it describes a
   * different project than the one being installed.
   */
  readonly previewInputs: PreviewInputs;
  /** Redacted URLs of the remote sources contributing to this run; empty for a purely local one. */
  readonly remoteSources?: readonly string[];
  readonly nonInteractive?: boolean;
  readonly approvedCommands?: readonly string[];
}
