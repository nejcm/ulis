import type { Logger } from "../build.js";
import type { ExtensionsConfig } from "../schema.js";

export type Runner = "npx" | "bunx";

export interface InstallContext {
  readonly outputDir: string;
  readonly destBase: string;
  readonly userHome: string;
  readonly globalInstall: boolean;
  readonly backup: boolean;
  readonly timestamp: string;
  readonly extensions: ExtensionsConfig;
  readonly runner: Runner;
  readonly installExtensionsEnabled: boolean;
  readonly logger?: Logger;
}
