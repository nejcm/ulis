import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { analyzePresets, runBuild } from "./build.js";
import { ULIS_GENERATED_DIRNAME, ULIS_PROVENANCE_FILENAME } from "./config.js";
import { generate, writeResult } from "./generators/index.js";
import { loadDotEnv } from "./install/dotenv.js";
import { InstallError } from "./install/errors.js";
import { logHeader, logInfo, logWarn } from "./install/log.js";
import { preflightOwnership, reconcileOwnership } from "./install/manifest.js";
import { installClaude, installCodex, installCursor, installForgecode, installOpencode } from "./install/platforms.js";
import { installExtensions, installSkills, runPlatformExtensions } from "./install/post-install.js";
import type { PreviewInputs } from "./install/preview.js";
import { makeTimestamp, resolveRunner } from "./install/runner.js";
import { resolveGlobalInstall } from "./install/scope.js";
import { confirmRemoteCommands } from "./install/trust-gate.js";
import type { GeneratedInstallOptions, InstallContext, InstallOptions, PresetInstallOptions } from "./install/types.js";
import { loadExtensions, mergeExtensionsConfigs } from "./parsers/extensions.js";
import { loadSkills, mergeSkillsConfigs } from "./parsers/skills.js";
import { PLATFORMS, uniquePlatforms, type Platform } from "./platforms.js";
import { UlisConfigSchema } from "./schema.js";
import { loadValidatedConfigFile, presetDiagnostic } from "./utils/config-loader.js";
import { throwIfAborted, yieldToEventLoop } from "./utils/interrupt.js";
import { logger as defaultLogger } from "./utils/logger.js";
import { legacyRootRecordPath, readRecordedRemoteSources } from "./utils/provenance.js";

export type { Runner } from "./install/types.js";

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

    const skillsConfig = mergeSkillsConfigs([
      ...(options.presets ?? []).map((preset) => loadSkills(preset.dir, presetDiagnostic(preset))),
      loadSkills(sourceDir, { source: "base", sourceDir }),
    ]);
    const extensionsConfig = mergeExtensionsConfigs([
      ...(options.presets ?? []).map((preset) => loadExtensions(preset.dir, presetDiagnostic(preset))),
      loadExtensions(sourceDir, { source: "base", sourceDir }),
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
    const previewInputs: PreviewInputs = { sourceDir, presets: options.presets ?? [], platforms };

    // The gate runs before the build, not only before the copy. `runBuild` writes the remote-authored
    // merged tree into `<source>/generated/`, so gating after it would leave remote-authored files in
    // the user's own repository whatever they answered - "declining installs nothing" has to be true
    // of the source tree too, not only of the destinations. The preview regenerates in memory and
    // never reads that tree, so it loses nothing by going first. The list agreed to here is handed
    // to `installGeneratedOutput` as the approved one, which re-checks it against a plan rebuilt
    // after the build: consent and execution still compare, they just now bracket the build.
    let approvedCommands = options.approvedCommands;
    if (remoteInTheMix) {
      // Same reason as the checkpoint in `installGeneratedOutput`: a user who has already pressed
      // Ctrl-C must not be shown a "Run these commands?" question on the way out.
      throwIfAborted(options.signal);
      const approved = await confirmRemoteCommands({
        plan: {
          platforms,
          skillsConfig,
          extensionsConfig,
          previewInputs,
          runner,
          globalInstall,
          installExtensionsEnabled,
          installSkillsEnabled,
        },
        logger,
        remoteSources: options.remoteSources,
        nonInteractive: options.nonInteractive,
        approvedCommands: options.approvedCommands,
      });
      if (approved === false) {
        logWarn(logger, "Declined. Nothing from the remote source was installed.");
        return [];
      }
      approvedCommands = approved;
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
      previewInputs,
      runner,
      installExtensionsEnabled,
      installSkillsEnabled,
      logger,
      remoteSources: options.remoteSources,
      nonInteractive: options.nonInteractive,
      approvedCommands,
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
      // `generate` and `writeResult` are synchronous; same reason as the install loop below.
      await yieldToEventLoop();
      throwIfAborted(options.signal);
      const outDir = join(outputDir, target);
      const result = generate(target, analysis.project);
      if (!result) throw new Error(`No generator registered for platform: ${target}`);
      // This temporary tree is removed in `finally`; the marker keeps `writeResult` uniform but is
      // not read by the preset install path.
      writeResult(result, outDir, target, logger, remoteUrls);
    }

    throwIfAborted(options.signal);
    const skillsConfig = mergeSkillsConfigs(presets.map((preset) => loadSkills(preset.dir, presetDiagnostic(preset))));
    const extensionsConfig = mergeExtensionsConfigs(
      presets.map((preset) => loadExtensions(preset.dir, presetDiagnostic(preset))),
    );

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
  // A run that reaches here after an interrupt is a user who already said stop; putting a
  // "Run these commands?" question to them is answering the wrong question.
  throwIfAborted(options.signal);
  if (
    !(await confirmRemoteCommands({
      plan: {
        platforms: options.platforms,
        skillsConfig: options.skillsConfig,
        extensionsConfig: options.extensionsConfig,
        previewInputs: options.previewInputs,
        runner: options.runner,
        globalInstall: options.globalInstall,
        installExtensionsEnabled: options.installExtensionsEnabled,
        installSkillsEnabled: options.installSkillsEnabled,
      },
      logger: options.logger,
      remoteSources: options.remoteSources,
      nonInteractive: options.nonInteractive,
      approvedCommands: options.approvedCommands,
    }))
  ) {
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
      // Every installer below is synchronous, so without this the loop never returns to the event
      // loop and the checkpoint on the next line cannot see a Ctrl-C that landed mid-write.
      await yieldToEventLoop();
      throwIfAborted(options.signal, failures[0]?.error);
      const platformOwnership = ownership.get(platform);
      if (!platformOwnership) throw new InstallError(`Missing ownership preflight data for ${platform}`);
      try {
        switch (platform) {
          case "opencode":
            await installOpencode(context, platformOwnership);
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

export { __test } from "./install/runtime.js";
