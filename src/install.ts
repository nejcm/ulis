import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stdin } from "node:process";

import { analyzePresets, runBuild, type Logger } from "./build.js";
import { ULIS_GENERATED_DIRNAME, ULIS_PROVENANCE_FILENAME } from "./config.js";
import { generate, writeResult } from "./generators/index.js";
import { InstallError } from "./install/errors.js";
import { preflightOwnership, reconcileOwnership } from "./install/manifest.js";
import { installClaude, installCodex, installCursor, installForgecode, installOpencode } from "./install/platforms.js";
import { formatCommandPreview, previewInstalledExecution, type PreviewInputs } from "./install/preview.js";
import type { InstallContext, Runner as InstallRunner } from "./install/types.js";
import { loadExtensions, mergeExtensionsConfigs } from "./parsers/extensions.js";
import { loadSkills, mergeSkillsConfigs } from "./parsers/skills.js";
import { isSamePath, PLATFORMS, uniquePlatforms, type Platform } from "./platforms.js";
import { UlisConfigSchema, type ExtensionsConfig, type SkillsConfig } from "./schema.js";
import { assertShellSafeArgv, commandExists as commandExistsOnPath } from "./utils/command.js";
import { loadValidatedConfigFile } from "./utils/config-loader.js";
import { logger as defaultLogger } from "./utils/logger.js";
import { confirm } from "./utils/prompt.js";
import { legacyRootRecordPath, readRecordedRemoteSources } from "./utils/provenance.js";
import { sanitizeLogText } from "./utils/redact.js";
import type { ResolvedPreset } from "./utils/resolve-presets.js";

export type { Runner } from "./install/types.js";

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
  readonly runner?: InstallRunner;
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
  readonly runner?: InstallRunner;
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

type RunCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawnSync>[2],
) => ReturnType<typeof spawnSync>;

export interface AsyncCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

type SkillInstallLog =
  | { readonly level: "success"; readonly message: string }
  | { readonly level: "warn"; readonly message: string; readonly name: string };

type RunAsyncCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
) => Promise<AsyncCommandResult>;

interface RuntimeDependencies {
  readonly runCommand: RunCommand;
  readonly runAsyncCommand: RunAsyncCommand;
  /** Seam for the trust gate, so tests can answer it without a terminal. */
  readonly confirm: (question: string) => Promise<boolean>;
}

interface GeneratedInstallOptions {
  readonly outputDir: string;
  readonly destBase: string;
  readonly userHome: string;
  readonly globalInstall: boolean;
  readonly backup: boolean;
  readonly prune: boolean;
  readonly platforms: readonly Platform[];
  readonly skillsConfig: SkillsConfig;
  readonly extensionsConfig: ExtensionsConfig;
  readonly runner: InstallRunner;
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

const defaultRuntimeDependencies: RuntimeDependencies = {
  runCommand(command, args, options) {
    return spawnSync(command, [...args], options);
  },
  runAsyncCommand(command, args, options) {
    return runAsyncCommand(resolveExecutable(command), args, options);
  },
  confirm(question) {
    // The trust gate is a security boundary: a piped `y` must not answer it. Without a terminal the
    // question cannot be put at all, and that is a failure rather than a decision - a cron job or a
    // wrapper script that silently installed nothing and exited 0 would read as a successful run.
    // An interactive "no" is the opposite: a choice, and it exits 0. This throw is what enforces
    // that, so `requireTty` below would only ever re-check what is already known to be true here -
    // dropped, so the actionable message above is the only thing a caller ever sees.
    if (!stdin.isTTY) {
      throw new InstallError(
        "Remote source commands need confirmation, but stdin is not a terminal. " +
          "Re-run in a terminal to review them, or pass -y to accept them up front.",
      );
    }
    return confirm(question);
  },
};

let runtimeDependencies: RuntimeDependencies = { ...defaultRuntimeDependencies };

/**
 * Variables that steer how a child process finds, fetches and loads code. A remote `.env` is attacker-
 * controlled, so setting one of these would hijack the very `npx`/`bunx` command the user approved.
 * Local sources keep the old behaviour.
 *
 * `HOME`/`USERPROFILE` are here because they relocate where `npx`/`bunx` read `.npmrc` and
 * `.bunfig.toml` (as does `XDG_CONFIG_HOME` on Linux), and `script-shell=` in an `.npmrc` is a
 * code-execution primitive; `ComSpec` is the
 * shell Node launches for `spawn({ shell: true })` on Windows; `SSH_ASKPASS`/`SSH_AUTH_SOCK` are the
 * ssh-side hole next to the `GIT_*` ones.
 */
const UNTRUSTED_ENV_DENYLIST =
  /^(?:PATH|HOME|USERPROFILE|XDG_CONFIG_HOME|ComSpec|NODE_.*|npm_.*|BUN_.*|LD_.*|DYLD_.*|GIT_.*|SSH_.*|(?:HTTP|HTTPS|ALL|NO)_PROXY)$/iu;

/**
 * Load environment variables from `<rootDir>/.env` without overriding existing values.
 * `untrusted` marks a remote source, whose `.env` may not set {@link UNTRUSTED_ENV_DENYLIST} keys.
 */
export function loadDotEnv(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { readonly untrusted?: boolean } = {},
): void {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  let lines: readonly string[];
  try {
    lines = readFileSync(envPath, "utf8").split(/\r?\n/u);
  } catch (error) {
    throw new InstallError(`Failed to read .env file at ${envPath}`, error);
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || key in env || (options.untrusted && UNTRUSTED_ENV_DENYLIST.test(key))) {
      continue;
    }

    const hasMatchingQuotes =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"));
    env[key] = hasMatchingQuotes ? rawValue.slice(1, -1) : rawValue;
  }
}

export function resolveGlobalInstall(options: {
  readonly globalInstall?: boolean;
  readonly destBase: string;
  readonly userHome: string;
}): boolean {
  return options.globalInstall ?? isSamePath(options.destBase, options.userHome);
}

/**
 * Install generated per-platform configs from source to destination base directory.
 */
export async function runInstall(options: InstallOptions): Promise<readonly Platform[]> {
  const logger = options.logger ?? defaultLogger;
  const sourceDir = resolve(options.sourceDir);
  const destBase = resolve(options.destBase);
  const outputDir = resolve(options.outputDir ?? join(sourceDir, ULIS_GENERATED_DIRNAME));
  const platforms = options.platforms ? uniquePlatforms(options.platforms) : [...PLATFORMS];
  const userHome = resolve(options.userHome ?? homedir());
  const globalInstall = resolveGlobalInstall({ ...options, destBase, userHome });
  const backup = options.backup ?? false;
  const prune = options.prune ?? true;
  // A remote source never gets to skip the build. The trust gate previews what `generate()` would
  // produce; installing `outputDir` instead would install whatever a `generated/` tree committed to
  // the repository happens to hold, which the gate has never looked at - the preview and the install
  // would be reading different bytes. A committed `generated/` tree has no legitimate use in a
  // source anyway, so removing the divergence beats mirroring it in a second code path.
  const remoteInTheMix = (options.remoteSources?.length ?? 0) > 0;
  const rebuild = remoteInTheMix || (options.rebuild ?? false);

  // `remoteInTheMix` is only true when this run itself resolved a remote preset, which forces
  // `rebuild` above regardless of `--skip-rebuild`. So whenever `rebuild` is still false here, this
  // run resolved nothing remote of its own - if any platform this run is about to install was
  // nonetheless built from a remote source (a prior `build --preset <url>`, say), there is no clone
  // left to rebuild from and no fresh preview to gate on. Refuse rather than install it unreviewed.
  // Scoped to `platforms`: a record naming only a platform this run does not touch must not block it.
  // Runs even when `platforms` ends up empty below - harmless in practice only because the "No
  // platforms selected" early return two blocks down makes an empty list a no-op either way. That
  // coupling is incidental, not load-bearing: don't rely on it if this check ever moves.
  if (!rebuild) {
    const legacyPath = legacyRootRecordPath(outputDir);
    if (existsSync(legacyPath)) {
      throw new InstallError(
        `The generated tree at ${outputDir} carries a provenance record from a pre-release build of ULIS, which recorded provenance for the whole tree rather than per platform. ` +
          "Run a full `ulis build` (no --target) to regenerate it, then retry.",
      );
    }

    const recordedRemoteSources = readRecordedRemoteSources(outputDir, platforms);
    if (recordedRemoteSources.length > 0) {
      const recordedPlatforms = platforms.filter((platform) =>
        existsSync(join(outputDir, platform, ULIS_PROVENANCE_FILENAME)),
      );
      throw new InstallError(
        `This generated tree was built from ${recordedRemoteSources.join(", ")}; re-run ` +
          `\`ulis install --preset ${recordedRemoteSources.join(",")}\` so the commands can be reviewed against a fresh build. ` +
          `Recorded for: ${recordedPlatforms.join(", ")}.`,
      );
    }
  }

  // A remote source's `.env` is remote-controlled and must not outlive this install in a long-lived
  // process (the TUI runs installs in-process). `loadDotEnv` only ever adds keys, so dropping the
  // keys it added is a complete restore.
  const preexistingEnvKeys = new Set(Object.keys(process.env));

  try {
    // Inside the `try`: the first call can have added keys before the second one throws.
    loadDotEnv(destBase);
    // A cloned source's `.env` is written by whoever owns the repository and serves no purpose the
    // destination's own `.env` does not already serve, so it is not read at all. Otherwise any remote
    // contributor arms the denylist: a local source's `.env` loses its loader-steering keys for this
    // run when a remote preset is in the mix - the over-strict direction is the safe one.
    const sourceIsRemote = options.sourceIsRemote ?? false;
    if (!sourceIsRemote) {
      loadDotEnv(sourceDir, process.env, { untrusted: (options.remoteSources?.length ?? 0) > 0 });
    }

    logHeader(logger, `ULIS Install (${process.platform === "win32" ? "Windows" : "Linux/macOS"})`);
    logInfo(logger, `Source: ${options.sourceLabel ?? sourceDir}`);
    if (sourceIsRemote) {
      logInfo(logger, "Skipped the source tree's .env: a remote source's .env is never read.");
    }
    logInfo(logger, `Output (generated): ${outputDir}`);
    logInfo(logger, `Destination base: ${destBase}`);
    logInfo(logger, `Platforms: ${platforms.join(", ")}`);

    if (platforms.length === 0) {
      logWarn(logger, "No platforms selected. Nothing to install.");
      return [];
    }

    const missingBuildOutputs = platforms.some((platform) => !existsSync(join(outputDir, platform)));
    if (rebuild || missingBuildOutputs) {
      logWarn(
        logger,
        !rebuild
          ? "Missing generated output. Running build."
          : remoteInTheMix && options.rebuild === false
            ? "Rebuilding generated configs before install: a remote source cannot skip the build, because the trust gate previews what the build produces."
            : "Rebuilding generated configs before install.",
      );
      runBuild({ targets: platforms, sourceDir, outputDir, logger, presets: options.presets });
    }

    const skillsConfig = mergeSkillsConfigs([
      ...(options.presets ?? []).map((preset) => loadSkills(preset.dir)),
      loadSkills(sourceDir),
    ]);
    const extensionsConfig = mergeExtensionsConfigs([
      ...(options.presets ?? []).map((preset) => loadExtensions(preset.dir)),
      loadExtensions(sourceDir),
    ]);

    const installExtensionsEnabled = options.installExtensions ?? true;
    const installSkillsEnabled = options.installSkills ?? true;
    const ulisConfig = loadValidatedConfigFile({
      dir: sourceDir,
      baseName: "config",
      schema: UlisConfigSchema,
      defaultValue: { version: 1, name: "ulis" },
    });
    const runner = resolveRunner({ cliFlag: options.runner, configValue: ulisConfig.runner });

    const failureCount = await installGeneratedOutput({
      outputDir,
      destBase,
      userHome,
      globalInstall,
      backup,
      prune,
      platforms,
      skillsConfig,
      extensionsConfig,
      previewInputs: { sourceDir, presets: options.presets ?? [], platforms },
      runner,
      installExtensionsEnabled,
      installSkillsEnabled,
      logger,
      remoteSources: options.remoteSources,
      nonInteractive: options.nonInteractive,
      approvedCommands: options.approvedCommands,
      signal: options.signal,
    });

    if (failureCount === false) return [];
    if (failureCount > 0) {
      throw new InstallError(
        `${failureCount} external skill or extension command${failureCount === 1 ? "" : "s"} failed.`,
      );
    }
    logHeader(logger, "Installation Complete");
    return platforms;
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!preexistingEnvKeys.has(key)) delete process.env[key];
    }
  }
}

/**
 * Install selected presets as the complete source without requiring a base source tree.
 */
export async function runPresetInstall(options: PresetInstallOptions): Promise<readonly Platform[]> {
  const logger = options.logger ?? defaultLogger;
  const presets = options.presets;
  if (presets.length === 0) {
    throw new Error("Select at least one preset to install.");
  }

  const destBase = resolve(options.destBase);
  const platforms = options.platforms ? uniquePlatforms(options.platforms) : [...PLATFORMS];
  const userHome = resolve(options.userHome ?? homedir());
  const globalInstall = resolveGlobalInstall({ ...options, destBase, userHome });
  const backup = options.backup ?? false;
  const prune = options.prune ?? true;
  const installExtensionsEnabled = options.installExtensions ?? true;
  const installSkillsEnabled = options.installSkills ?? true;
  const runner = resolveRunner({ cliFlag: options.runner });
  const tempRoot = mkdtempSync(join(tmpdir(), "ulis-preset-install-"));
  const outputDir = join(tempRoot, ULIS_GENERATED_DIRNAME);
  // Same reason as `runInstall`: the TUI installs in-process, so a `.env` must not outlive the run.
  const preexistingEnvKeys = new Set(Object.keys(process.env));

  try {
    loadDotEnv(destBase);

    logHeader(logger, `ULIS Preset Install (${process.platform === "win32" ? "Windows" : "Linux/macOS"})`);
    logInfo(logger, `Presets: ${presets.map((preset) => preset.name).join(", ")}`);
    logInfo(logger, `Output (temporary): ${outputDir}`);
    logInfo(logger, `Destination base: ${destBase}`);
    logInfo(logger, `Platforms: ${platforms.join(", ")}`);

    if (platforms.length === 0) {
      logWarn(logger, "No platforms selected. Nothing to install.");
      return [];
    }

    throwIfAborted(options.signal);
    const analysis = analyzePresets({ presets, logger });
    const remoteUrls = presets.flatMap((preset) => (preset.remoteUrl ? [preset.remoteUrl] : []));
    for (const target of platforms) {
      throwIfAborted(options.signal);
      const outDir = join(outputDir, target);
      const result = generate(target, analysis.project);
      if (!result) throw new Error(`No generator registered for platform: ${target}`);
      // This temporary tree is removed in `finally`; the marker keeps `writeResult` uniform but is
      // not read by the preset install path.
      writeResult(result, outDir, target, logger, remoteUrls);
    }

    throwIfAborted(options.signal);
    const skillsConfig = mergeSkillsConfigs(presets.map((preset) => loadSkills(preset.dir)));
    const extensionsConfig = mergeExtensionsConfigs(presets.map((preset) => loadExtensions(preset.dir)));

    const failureCount = await installGeneratedOutput({
      outputDir,
      destBase,
      userHome,
      globalInstall,
      backup,
      prune,
      platforms,
      skillsConfig,
      extensionsConfig,
      previewInputs: { presets, platforms },
      runner,
      installExtensionsEnabled,
      installSkillsEnabled,
      logger,
      remoteSources: options.remoteSources,
      nonInteractive: options.nonInteractive,
      approvedCommands: options.approvedCommands,
      signal: options.signal,
    });

    throwIfAborted(options.signal);
    if (failureCount === false) return [];
    if (failureCount > 0) {
      throw new InstallError(
        `${failureCount} external skill or extension command${failureCount === 1 ? "" : "s"} failed.`,
      );
    }
    logHeader(logger, "Preset Installation Complete");
    return platforms;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!preexistingEnvKeys.has(key)) delete process.env[key];
    }
  }
}

/** Returns false when the trust gate was declined, otherwise the failed post-install command count. */
async function installGeneratedOutput(options: GeneratedInstallOptions): Promise<number | false> {
  // The trust gate, before anything reaches the destination. Everything below either spawns a
  // command the remote source chose or writes a file the host agent loads as behaviour - a `.mcp.json`
  // server it spawns on next launch, a `raw/` hook fragment it runs on next session start. Gating
  // after the writes would leave the payload on disk no matter the answer, so declining here has to
  // mean nothing is installed at all. Both runInstall and runPresetInstall funnel through here.
  if (!(await confirmRemoteCommands(options))) {
    logWarn(options.logger, "Declined. Nothing from the remote source was installed.");
    return false;
  }

  const timestamp = makeTimestamp();
  const ownership = preflightOwnership(
    options.platforms,
    options.outputDir,
    options.destBase,
    options.userHome,
    options.prune,
  );
  const context: InstallContext = {
    outputDir: options.outputDir,
    destBase: options.destBase,
    userHome: options.userHome,
    globalInstall: options.globalInstall,
    backup: options.backup,
    prune: options.prune,
    timestamp,
    extensions: options.extensionsConfig,
    runner: options.runner,
    installExtensionsEnabled: options.installExtensionsEnabled,
    logger: options.logger,
  };

  const installed: Platform[] = [];
  const failures: { readonly platform: Platform; readonly error: unknown }[] = [];
  const failedSkills: string[] = [];
  const failedExtensions: string[] = [];
  try {
    for (const platform of options.platforms) {
      throwIfAborted(options.signal, failures[0]?.error);
      const platformOwnership = ownership.get(platform);
      if (!platformOwnership) throw new InstallError(`Missing ownership preflight data for ${platform}`);
      try {
        switch (platform) {
          case "opencode":
            await installOpencode(context, platformOwnership.previous?.rootEntries);
            break;
          case "claude":
            await installClaude(context);
            break;
          case "codex":
            await installCodex(context);
            break;
          case "cursor":
            await installCursor(context);
            break;
          case "forgecode":
            await installForgecode(context);
            break;
        }
        reconcileOwnership(platform, platformOwnership, context.prune, context.logger);
        installed.push(platform);
      } catch (error) {
        throwIfAborted(options.signal, failures[0]?.error ?? error);
        failures.push({ platform, error });
      }
    }
    throwIfAborted(options.signal, failures[0]?.error);
    if (failures.length > 0) throw failures[0]!.error;

    if (options.installSkillsEnabled) {
      for (const platform of options.platforms) {
        throwIfAborted(options.signal);
        const platformSkills = options.skillsConfig[platform]?.skills ?? [];
        if (platformSkills.length > 0) {
          failedSkills.push(
            ...(await installSkills(
              platformSkills,
              platform,
              options.destBase,
              options.globalInstall,
              options.logger,
              [],
              options.signal,
            )),
          );
        }
      }

      const allSkills = options.skillsConfig["*"]?.skills ?? [];
      if (allSkills.length > 0) {
        logHeader(options.logger, "Installing External Skills");
        failedSkills.push(
          ...(await installSkills(
            allSkills,
            "*",
            options.destBase,
            options.globalInstall,
            options.logger,
            options.platforms,
            options.signal,
          )),
        );
      }
    }

    if (options.installExtensionsEnabled) {
      for (const platform of options.platforms) {
        throwIfAborted(options.signal);
        failedExtensions.push(...(await runPlatformExtensions(context, platform, options.signal)));
      }

      const allExtensions = options.extensionsConfig["*"]?.extensions ?? [];
      if (allExtensions.length > 0) {
        logHeader(options.logger, "Installing Extensions");
        failedExtensions.push(
          ...(await installExtensions(
            allExtensions,
            "*",
            options.destBase,
            options.runner,
            options.logger,
            options.signal,
          )),
        );
      }
    }
    return failedSkills.length + failedExtensions.length;
  } finally {
    if (installed.length > 0 || failures.length > 0) {
      const summary = `Install summary — installed: [${installed.join(", ")}]${
        failures.length > 0 ? `, failed: [${failures.map(({ platform }) => platform).join(", ")}]` : ""
      }${failedSkills.length > 0 ? `, failed external skills: [${failedSkills.join(", ")}]` : ""}${
        failedExtensions.length > 0 ? `, failed extensions: [${failedExtensions.join(", ")}]` : ""
      }`;
      if (failures.length + failedSkills.length + failedExtensions.length > 0) logWarn(options.logger, summary);
      else logInfo(options.logger, summary);
    }
  }
}

// map platform key to skills argument agent name
// only platforms supported by the `skills` CLI are listed here
const SKILL_PLATFORM_AGENT_NAMES: Partial<Record<Platform, string>> = {
  claude: "claude-code",
  opencode: "opencode",
  codex: "codex",
  cursor: "cursor",
};

const SKILL_INSTALL_CONCURRENCY = 4;

function normalizeSkillArgs(args: readonly string[] = []): string[] {
  return args.flatMap((arg) => arg.trim().split(/\s+/));
}

function skillAgentNames(platform: Platform | "*", selectedPlatforms: readonly Platform[]): string[] {
  return platform === "*"
    ? selectedPlatforms.flatMap((selectedPlatform) => {
        const agentName = SKILL_PLATFORM_AGENT_NAMES[selectedPlatform];
        return agentName ? [agentName] : [];
      })
    : [SKILL_PLATFORM_AGENT_NAMES[platform] ?? platform];
}

function skillNpxArgs(
  skill: { name: string; args?: readonly string[] },
  agentFlags: readonly string[],
  globalInstall: boolean,
): string[] {
  return [
    "skills@latest",
    "add",
    skill.name,
    ...agentFlags,
    ...(globalInstall ? ["-g"] : ["--project"]),
    "--yes",
    ...normalizeSkillArgs(skill.args),
  ];
}

/**
 * argv for one `extensions.yaml` entry. `--` ends option parsing so a name is read as a package even
 * if it looks like a flag; both runners accept it (verified against npx 11 and bun 1.3).
 *
 * It is only load-bearing for `npx`, which resolves everything after `--` as a package spec. `bunx`
 * accepts `--` but keeps parsing its own flags past it (`bunx -- --version` still prints bun's
 * version), so what actually covers bunx is `PackageNameSchema`
 * (`src/schema/shared.ts`) refusing a name that starts with `-` at the input contract. Shared with the preview so the two cannot drift.
 */
function extensionRunnerArgs(extension: { name: string; args?: readonly string[] }): string[] {
  return ["--", extension.name, ...(extension.args ?? [])];
}

/**
 * Every command a remote source is about to run, exactly as it will be spawned, plus the files it
 * installs that a host agent later executes on its own. Built from the same helpers the install
 * paths use, so the prompt cannot drift from what actually executes.
 */
type RemoteCommandPlan = Pick<
  GeneratedInstallOptions,
  | "platforms"
  | "skillsConfig"
  | "extensionsConfig"
  | "previewInputs"
  | "runner"
  | "globalInstall"
  | "installExtensionsEnabled"
  | "installSkillsEnabled"
>;

/**
 * The commands a remote source would run, for a caller that gates consent before the install starts
 * (the TUI review screen). Loads configs the same way the install paths do and formats through the
 * same preview helper, so what is shown cannot drift from what executes.
 */
export function planRemoteCommands(options: {
  readonly sourceDir?: string;
  readonly presets?: readonly ResolvedPreset[];
  readonly platforms: readonly Platform[];
  readonly destBase: string;
  readonly userHome?: string;
  readonly globalInstall?: boolean;
  readonly runner?: InstallRunner;
  readonly installExtensions?: boolean;
  readonly installSkills?: boolean;
}): readonly string[] {
  const destBase = resolve(options.destBase);
  const userHome = resolve(options.userHome ?? homedir());
  const dirs = [
    ...(options.presets ?? []).map((preset) => preset.dir),
    ...(options.sourceDir ? [options.sourceDir] : []),
  ];
  const ulisConfig = options.sourceDir
    ? loadValidatedConfigFile({
        dir: options.sourceDir,
        baseName: "config",
        schema: UlisConfigSchema,
        defaultValue: { version: 1, name: "ulis" },
      })
    : undefined;

  return renderCommandPlan({
    platforms: uniquePlatforms(options.platforms),
    skillsConfig: mergeSkillsConfigs(dirs.map((dir) => loadSkills(dir))),
    extensionsConfig: mergeExtensionsConfigs(dirs.map((dir) => loadExtensions(dir))),
    previewInputs: {
      sourceDir: options.sourceDir,
      presets: options.presets ?? [],
      platforms: uniquePlatforms(options.platforms),
    },
    runner: resolveRunner({ cliFlag: options.runner, configValue: ulisConfig?.runner }),
    globalInstall: resolveGlobalInstall({ ...options, destBase, userHome }),
    installExtensionsEnabled: options.installExtensions ?? true,
    installSkillsEnabled: options.installSkills ?? true,
  });
}

function renderCommandPlan(options: RemoteCommandPlan): string[] {
  // Written first, and executed by the host agent rather than by us, so they lead the list.
  const installs = previewInstalledExecution(options.previewInputs);
  const commands: string[][] = [];
  if (options.installSkillsEnabled) {
    for (const platform of options.platforms) {
      const agentNames = skillAgentNames(platform, []);
      if (agentNames.length === 0) continue;
      for (const skill of options.skillsConfig[platform]?.skills ?? []) {
        commands.push(["npx", ...skillNpxArgs(skill, ["-a", ...agentNames], options.globalInstall)]);
      }
    }
    const agentNames = skillAgentNames("*", options.platforms);
    if (agentNames.length > 0) {
      for (const skill of options.skillsConfig["*"]?.skills ?? []) {
        commands.push(["npx", ...skillNpxArgs(skill, ["-a", ...agentNames], options.globalInstall)]);
      }
    }
  }
  if (options.installExtensionsEnabled) {
    for (const platform of [...options.platforms, "*" as const]) {
      for (const extension of options.extensionsConfig[platform]?.extensions ?? []) {
        commands.push([options.runner, ...extensionRunnerArgs(extension)]);
      }
    }
  }
  return [...installs, ...commands.map((argv) => formatCommandPreview(argv))];
}

/**
 * The trust gate: local presets you authored, remote ones you did not. Returns true when there is
 * nothing to gate, when the run is purely local, when consent given elsewhere still matches what
 * is about to run, or when the user says yes here.
 */
async function confirmRemoteCommands(options: GeneratedInstallOptions): Promise<boolean> {
  const remoteSources = options.remoteSources ?? [];
  if (remoteSources.length === 0) return true;
  // No early exit on an empty plan. An empty plan does not mean "nothing happens": it means nothing
  // this planner recognises as executable, and the install still writes a remote source's agents,
  // skills, rules and instructions into the destination. Skipping the gate there is what let a
  // payload the enumeration had not learned about yet install with no prompt at all.
  const commands = renderCommandPlan(options);

  // A caller that already obtained consent — the TUI, which shows the list on its review screen
  // because it owns the terminal and cannot prompt on stdin — passes back exactly what it
  // displayed. Comparing it here, against a list rebuilt from the real install options at the
  // point of execution, is what makes "what was shown is what runs" a fact rather than a
  // convention: any divergence, however it arose, stops the run instead of executing unseen
  // commands.
  if (options.approvedCommands) {
    if (commandsMatch(options.approvedCommands, commands)) return true;
    logWarn(options.logger, "Commands changed since they were reviewed:");
    for (const command of commands) logInfo(options.logger, `  ${command}`);
    throw new InstallError("Refusing to run remote commands that differ from the ones reviewed. Review them again.");
  }

  if (options.nonInteractive) return true;

  logHeader(options.logger, "Remote Source Commands");
  for (const url of remoteSources) logInfo(options.logger, `From ${url}`);
  for (const command of commands) logInfo(options.logger, `  ${command}`);
  if (commands.length > 0) return await runtimeDependencies.confirm("Run these commands?");

  // Never claim there is nothing to run. Every bypass found so far printed a confident "nothing
  // here" over a payload that was installing, and a false statement is worse than a missing one.
  logInfo(options.logger, "  Nothing here was recognised as executable - which is not a guarantee.");
  logInfo(options.logger, `  Its files will still be installed for: ${options.platforms.join(", ")}.`);
  return await runtimeDependencies.confirm("Install from this remote source?");
}

function commandsMatch(approved: readonly string[], planned: readonly string[]): boolean {
  // Order matters: it is the order they will be spawned in.
  return approved.length === planned.length && approved.every((command, index) => command === planned[index]);
}

async function installSkills(
  skills: readonly { key?: string; name: string; args?: readonly string[] }[],
  platform: Platform | "*",
  installBaseDir: string,
  globalInstall: boolean,
  logger?: Logger,
  selectedPlatforms: readonly Platform[] = [],
  signal?: AbortSignal,
): Promise<readonly string[]> {
  if (skills.length === 0) return [];
  const agentNames = skillAgentNames(platform, selectedPlatforms);
  if (agentNames.length === 0) return [];
  const agentFlags = ["-a", ...agentNames];

  const results = await runBounded(
    skills,
    SKILL_INSTALL_CONCURRENCY,
    async (skill): Promise<SkillInstallLog> => {
      throwIfAborted(signal);
      const npxArgs = skillNpxArgs(skill, agentFlags, globalInstall);
      const name = `${platform}: ${skill.key ?? skill.name}`;
      logInfo(logger, `Installing ${platform} skill: ${skill.key ?? skill.name}`);
      let result: AsyncCommandResult;
      try {
        result = await runSkillCommand("npx", npxArgs, {
          stdio: ["ignore", "pipe", "pipe"],
          cwd: installBaseDir,
          shell: process.platform === "win32",
          signal,
        });
      } catch (error) {
        throwIfAborted(signal, error);
        return {
          level: "warn",
          name,
          message: `Failed to install ${platform} skill: ${skill.key ?? skill.name} (${formatCommandFailure({
            error: error instanceof Error ? error : new Error(String(error)),
          })})`,
        };
      }
      throwIfAborted(signal);
      if (result.status !== 0) {
        return {
          level: "warn",
          name,
          message: `Failed to install ${platform} skill: ${skill.key ?? skill.name} (${formatCommandFailure(result)})`,
        };
      }
      return { level: "success", message: `${platform} skill: ${skill.key ?? skill.name}` };
    },
    signal,
  );

  for (const result of results) {
    if (result.level === "warn") logWarn(logger, result.message);
    else logSuccess(logger, result.message);
  }
  return results.flatMap((result) => (result.level === "warn" ? [result.name] : []));
}

async function runBounded<T, U>(
  items: readonly T[],
  concurrency: number,
  runItem: (item: T) => Promise<U>,
  signal?: AbortSignal,
): Promise<readonly U[]> {
  let nextIndex = 0;
  const results: U[] = [];
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      throwIfAborted(signal);
      const itemIndex = nextIndex;
      const item = items[itemIndex]!;
      nextIndex += 1;
      results[itemIndex] = await runItem(item);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runPlatformExtensions(
  context: InstallContext,
  platform: Platform,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  if (!context.installExtensionsEnabled) return [];
  const entries = context.extensions[platform]?.extensions ?? [];
  if (entries.length === 0) return [];
  return installExtensions(entries, platform, context.destBase, context.runner, context.logger, signal);
}

async function installExtensions(
  extensions: readonly { key?: string; name: string; args?: readonly string[] }[],
  platform: Platform | "*",
  installBaseDir: string,
  runner: InstallRunner,
  logger?: Logger,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  if (extensions.length === 0) return [];
  const failed: string[] = [];
  if (!commandExists(runner)) {
    logWarn(
      logger,
      `${runner} not found on PATH - failed to install ${platform} extensions. Pass --skip-extensions to proceed without them.`,
    );
    return extensions.map((extension) => `${platform}: ${extension.key ?? extension.name}`);
  }

  for (const extension of extensions) {
    throwIfAborted(signal);
    const args = extensionRunnerArgs(extension);
    // Same formatting as the trust preview: a raw argv here could print a credential, or use
    // terminal controls to erase the preview the user just approved.
    logInfo(logger, `Will run: ${formatCommandPreview([runner, ...args])}`);

    const name = `${platform}: ${extension.key ?? extension.name}`;
    let result: AsyncCommandResult;
    try {
      result = await runSkillCommand(runner, args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: installBaseDir,
        shell: process.platform === "win32",
        signal,
      });
    } catch (error) {
      throwIfAborted(signal, error);
      failed.push(name);
      logWarn(
        logger,
        `Failed to install ${platform} extension: ${extension.key ?? extension.name} (${formatCommandFailure({
          error: error instanceof Error ? error : new Error(String(error)),
        })})`,
      );
      continue;
    }
    throwIfAborted(signal);
    if (result.status !== 0) {
      failed.push(name);
      logWarn(
        logger,
        `Failed to install ${platform} extension: ${extension.key ?? extension.name} (${formatCommandFailure(result)})`,
      );
      continue;
    }
    logSuccess(logger, `${platform} extension: ${extension.key ?? extension.name}`);
  }
  return failed;
}

function throwIfAborted(signal?: AbortSignal, cause?: unknown): void {
  // Shared by both install paths, so the wording cannot name one of them.
  if (signal?.aborted) throw new Error("Install stopped by user.", { cause });
}

/**
 * Resolve which package runner to use for `extensions.yaml` entries.
 * Precedence: CLI flag → config.yaml → auto-detect (`bunx` if present, else `npx`).
 */
export function resolveRunner({
  cliFlag,
  configValue,
  hasCommand = commandExists,
}: {
  cliFlag?: InstallRunner;
  configValue?: InstallRunner;
  hasCommand?: (cmd: string) => boolean;
}): InstallRunner {
  if (cliFlag) return cliFlag;
  if (configValue) return configValue;
  return hasCommand("bunx") ? "bunx" : "npx";
}

/** {@link commandExistsOnPath}, bound to this module's mockable spawn. */
function commandExists(command: string): boolean {
  return commandExistsOnPath(command, runCommand);
}

function resolveExecutable(command: string): string {
  if (process.platform === "win32" && (command === "npx" || command === "bunx")) {
    return `${command}.cmd`;
  }
  return command;
}

export function formatCommandFailure(result: {
  stdout?: unknown;
  stderr?: unknown;
  status?: unknown;
  error?: Error;
}): string {
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const combined = `${stdout}\n${stderr}`
    // oxlint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // Child output is untrusted: it can echo a credentialed URL back, or carry terminal controls.
  return sanitizeLogText(combined[combined.length - 1] || result.error?.message || `exit ${result.status}`);
}

function makeTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
}

export function runCommand(command: string, args: readonly string[], options: Parameters<typeof spawnSync>[2]) {
  try {
    return runtimeDependencies.runCommand(command, args, options);
  } catch (error) {
    throw new InstallError(`Failed to run command: ${formatCommandPreview([command, ...args])}`, error);
  }
}

export async function runSkillCommand(
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
): Promise<AsyncCommandResult> {
  // The one place every skill, extension and clone launch passes through, so the shell check
  // belongs here rather than at each caller. `.cmd` shims force `shell: true` on Windows, which
  // means argv is concatenated rather than escaped — see {@link assertShellSafeArgv}.
  if (options?.shell) assertShellSafeArgv([command, ...args]);
  try {
    return await runtimeDependencies.runAsyncCommand(command, args, options);
  } catch (error) {
    throw new InstallError(`Failed to run command: ${formatCommandPreview([command, ...args])}`, error);
  }
}

function runAsyncCommand(
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
): Promise<AsyncCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], options);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer | string) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      resolve({
        status: 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error,
      });
    });
    child.on("close", (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

// Every install log line is sanitized here rather than at its call site. Much of what these print
// is remote-controlled — manifest entries, preset names, child process output — and a wrapper that
// has to be remembered at each site is one forgotten call away from letting a hostile manifest
// forge the trust preview. Sanitizing at the sink makes that unforgettable. `sanitizeLogText` is
// idempotent, so text already sanitized upstream (a command preview, say) passes through unchanged.

function logHeader(logger: Logger | undefined, message: string): void {
  // Headers are literals from this file, never remote text.
  logger?.header(message);
}

function logInfo(logger: Logger | undefined, message: string): void {
  logger?.info(sanitizeLogText(message));
}

function logSuccess(logger: Logger | undefined, message: string): void {
  logger?.success(sanitizeLogText(message));
}

function logWarn(logger: Logger | undefined, message: string): void {
  logger?.warn(sanitizeLogText(message));
}

export const __test = {
  setRuntimeDependencies(overrides: Partial<RuntimeDependencies>): void {
    runtimeDependencies = { ...runtimeDependencies, ...overrides };
  },
  resetRuntimeDependencies(): void {
    runtimeDependencies = { ...defaultRuntimeDependencies };
  },
};
