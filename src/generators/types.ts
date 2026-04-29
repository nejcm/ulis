import type { ParsedAgent } from "../parsers/agent.js";
import type { ParsedRule } from "../parsers/rule.js";
import type { ParsedSkill } from "../parsers/skill.js";
import type { Platform } from "../platforms.js";
import type { McpConfig, PermissionsConfig, PluginsConfig, UlisConfig } from "../schema.js";

/**
 * A single file to be written to disk. Generators return arrays of these
 * instead of calling `writeFile` directly, which keeps generation pure and
 * snapshot-testable.
 */
export interface FileArtifact {
  /** Path relative to the platform's output directory. */
  readonly path: string;
  readonly contents: string | Buffer;
}

/**
 * Post-generation imperative steps that fall outside the pure FileArtifact
 * contract: merging raw directory trees onto the output, and writing AGENTS.md
 * aliases. The writer executes these after emitting artifacts.
 */
export interface PostEmit {
  /** Absolute source directories to merge/copy into the output dir, in order. */
  readonly rawDirs: readonly string[];
  /** Alias filenames to write alongside an emitted AGENTS.md (e.g. "CLAUDE.md"). */
  readonly aliasFiles: readonly string[];
  /** Skill directories to deep-copy (used by platforms that ship skills as dirs). */
  readonly skillDirs: readonly {
    readonly name: string;
    readonly dir: string;
    /** Platform-specific frontmatter fields to merge into the copied SKILL.md. */
    readonly extraFrontmatter?: Record<string, unknown>;
  }[];
  /** Destination directory for `skillDirs` relative to `outDir`. Defaults to `"skills"`. */
  readonly skillsDestRelative?: string;
  /**
   * Content to append to files *after* raw-dir merges complete. Used by
   * platforms that inject a rules index into AGENTS.md (which raw/common may
   * have just written). Creates the file if it does not exist.
   */
  readonly appendAfterRaw?: readonly { readonly path: string; readonly content: string }[];
  /**
   * Absolute source directories to deep-copy to a relative dest under outDir.
   * Used by `docs/` and similar pass-through directories.
   */
  readonly copyDirs?: readonly { readonly src: string; readonly destRelative: string }[];
}

/** The complete output of running a generator for one platform. */
export interface GenerationResult {
  readonly artifacts: readonly FileArtifact[];
  readonly post: PostEmit;
}

/**
 * The platform-agnostic input to every generator. Collects everything parsed
 * and validated upstream in `runBuild`. Generators should return artifacts
 * without filesystem side effects, but may use `sourceDir` to read controlled
 * pass-through content such as raw directories, commands, rules, and skills.
 */
export interface ProjectBundle {
  readonly agents: readonly ParsedAgent[];
  readonly skills: readonly ParsedSkill[];
  readonly rules: readonly ParsedRule[];
  readonly mcp: McpConfig;
  readonly permissions: PermissionsConfig | undefined;
  readonly plugins: PluginsConfig | undefined;
  readonly ulisConfig: UlisConfig;
  /** Absolute path to the `.ulis/` source tree. Generators may read raw/, commands/, etc. from here. */
  readonly sourceDir: string;
}

export type GeneratorFn = (project: ProjectBundle, platform: Platform) => GenerationResult;
