import type { Logger } from "../build.js";
import type { Platform } from "../platforms.js";
import { runBounded } from "../utils/concurrency.js";
import { throwIfAborted } from "../utils/interrupt.js";
import { logInfo, logSuccess, logWarn } from "./log.js";
import { formatCommandPreview } from "./preview.js";
import { commandExists, formatCommandFailure, runSkillCommand } from "./runner.js";
import type { AsyncCommandResult, InstallContext, Runner as InstallRunner, SkillInstallLog } from "./types.js";

// map platform key to skills argument agent name
// only platforms supported by the `skills` CLI are listed here
const SKILL_PLATFORM_AGENT_NAMES: Partial<Record<Platform, string>> = {
  claude: "claude-code",
  opencode: "opencode",
  codex: "codex",
  cursor: "cursor",
};

const SKILL_INSTALL_CONCURRENCY = 4;

export function normalizeSkillArgs(args: readonly string[] = []): string[] {
  return args.flatMap((arg) => arg.trim().split(/\s+/));
}

export function skillAgentNames(platform: Platform | "*", selectedPlatforms: readonly Platform[]): string[] {
  return platform === "*"
    ? selectedPlatforms.flatMap((selectedPlatform) => {
        const agentName = SKILL_PLATFORM_AGENT_NAMES[selectedPlatform];
        return agentName ? [agentName] : [];
      })
    : [SKILL_PLATFORM_AGENT_NAMES[platform] ?? platform];
}

export function skillNpxArgs(
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
export function extensionRunnerArgs(extension: { name: string; args?: readonly string[] }): string[] {
  return ["--", extension.name, ...(extension.args ?? [])];
}

export async function installSkills(
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

export async function runPlatformExtensions(
  context: InstallContext,
  platform: Platform,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  if (!context.installExtensionsEnabled) return [];
  const entries = context.extensions[platform]?.extensions ?? [];
  if (entries.length === 0) return [];
  return installExtensions(entries, platform, context.destBase, context.runner, context.logger, signal);
}

export async function installExtensions(
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
