import { homedir } from "node:os";
import { resolve } from "node:path";

import type { Logger } from "../build.js";
import { loadExtensions, mergeExtensionsConfigs } from "../parsers/extensions.js";
import { loadSkills, mergeSkillsConfigs } from "../parsers/skills.js";
import { uniquePlatforms, type Platform } from "../platforms.js";
import { UlisConfigSchema } from "../schema.js";
import { loadValidatedConfigFile, presetDiagnostic, type ConfigDiagnosticOptions } from "../utils/config-loader.js";
import type { ResolvedPreset } from "../utils/resolve-presets.js";
import { InstallError } from "./errors.js";
import { logHeader, logInfo, logWarn } from "./log.js";
import { extensionRunnerArgs, skillAgentNames, skillNpxArgs } from "./post-install.js";
import { formatCommandPreview, previewInstalledExecution } from "./preview.js";
import { resolveRunner } from "./runner.js";
import { runtimeDependencies } from "./runtime.js";
import { resolveGlobalInstall } from "./scope.js";
import type { GeneratedInstallOptions, Runner as InstallRunner } from "./types.js";

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
 * What the trust gate itself reads. The commands to plan are nested under `plan` rather than
 * spread flat, so this stays the ~6 fields the gate actually touches instead of growing with
 * whatever {@link RemoteCommandPlan} needs to render a preview.
 */
type RemoteGateOptions = {
  readonly plan: RemoteCommandPlan;
  readonly logger: Logger;
  readonly remoteSources?: readonly string[];
  readonly nonInteractive?: boolean;
  readonly approvedCommands?: readonly string[];
};

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
  const layers: readonly Required<ConfigDiagnosticOptions>[] = [
    ...(options.presets ?? []).map((preset) => presetDiagnostic(preset)),
    ...(options.sourceDir ? [{ source: "base", sourceDir: options.sourceDir }] : []),
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
    skillsConfig: mergeSkillsConfigs(layers.map((layer) => loadSkills(layer.sourceDir, layer))),
    extensionsConfig: mergeExtensionsConfigs(layers.map((layer) => loadExtensions(layer.sourceDir, layer))),
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
export async function confirmRemoteCommands(options: RemoteGateOptions): Promise<readonly string[] | false> {
  const remoteSources = options.remoteSources ?? [];
  if (remoteSources.length === 0) return [];
  // No early exit on an empty plan. An empty plan does not mean "nothing happens": it means nothing
  // this planner recognises as executable, and the install still writes a remote source's agents,
  // skills, rules and instructions into the destination. Skipping the gate there is what let a
  // payload the enumeration had not learned about yet install with no prompt at all.
  const commands = renderCommandPlan(options.plan);

  // A caller that already obtained consent — the TUI, which shows the list on its review screen
  // because it owns the terminal and cannot prompt on stdin — passes back exactly what it
  // displayed. Comparing it here, against a list rebuilt from the real install options at the
  // point of execution, is what makes "what was shown is what runs" a fact rather than a
  // convention: any divergence, however it arose, stops the run instead of executing unseen
  // commands.
  if (options.approvedCommands) {
    if (commandsMatch(options.approvedCommands, commands)) return commands;
    logWarn(options.logger, "Commands changed since they were reviewed:");
    for (const command of commands) logInfo(options.logger, `  ${command}`);
    throw new InstallError("Refusing to run remote commands that differ from the ones reviewed. Review them again.");
  }

  logHeader(options.logger, "Remote Source Commands");
  for (const url of remoteSources) logInfo(options.logger, `From ${url}`);
  for (const command of commands) logInfo(options.logger, `  ${command}`);
  if (commands.length > 0) {
    if (options.nonInteractive) return commands;
    return (await runtimeDependencies.confirm("Run these commands?")) && commands;
  }

  // Never claim there is nothing to run. Every bypass found so far printed a confident "nothing
  // here" over a payload that was installing, and a false statement is worse than a missing one.
  // Printed before the -y exit, not after: the disclosure is the whole point of the -y change, and
  // an unattended run is precisely where a log line is the only record anyone ever sees.
  logInfo(options.logger, "  Nothing here was recognised as executable - which is not a guarantee.");
  logInfo(options.logger, `  Its files will still be installed for: ${options.plan.platforms.join(", ")}.`);
  if (options.nonInteractive) return commands;
  return (await runtimeDependencies.confirm("Install from this remote source?")) && commands;
}

function commandsMatch(approved: readonly string[], planned: readonly string[]): boolean {
  // Display order matters for consent. Spawn groups follow it; concurrent skills within a group may not.
  return approved.length === planned.length && approved.every((command, index) => command === planned[index]);
}
