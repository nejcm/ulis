import { runBuild } from "../build.js";
import { parsePlatformList, type Platform } from "../platforms.js";
import { log } from "../utils/logger.js";
import { resolveSource } from "../utils/resolve-source.js";

export interface BuildCmdOptions {
  readonly global?: boolean;
  readonly source?: string;
  readonly target?: string | string[];
  readonly targets?: string | string[];
}

export async function buildCmd(options: BuildCmdOptions = {}): Promise<void> {
  const { sourceDir } = resolveSource({ global: options.global, source: options.source });
  const targets = parseTargets(options);

  runBuild({ sourceDir, targets, logger: log });
}

export function parseTargets(options: BuildCmdOptions): readonly Platform[] | undefined {
  const raw = options.target ?? options.targets;
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  return parsePlatformList(list);
}
