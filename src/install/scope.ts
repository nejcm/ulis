import { isSamePath } from "../platforms.js";

/**
 * Whether `destBase` is the user's home directory — the boundary between a global install and a
 * project-local one.
 */
export function resolveGlobalInstall(options: {
  readonly globalInstall?: boolean;
  readonly destBase: string;
  readonly userHome: string;
}): boolean {
  return options.globalInstall ?? isSamePath(options.destBase, options.userHome);
}
