import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cac } from "cac";

import { buildCmd } from "./commands/build.js";
import { initCmd } from "./commands/init.js";
import { installCmd } from "./commands/install.js";
import { presetInstallCmd, presetListCmd } from "./commands/preset.js";
import { tuiCmd } from "./commands/tui.js";

function resolvePackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [join(here, "..", "package.json"), join(here, "..", "..", "package.json")];
    for (const candidate of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return "0.0.0";
}

function parseRunner(value: unknown): "npx" | "bunx" | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "npx" || value === "bunx") return value;
  throw new Error(`Invalid --runner: "${String(value)}". Expected "npx" or "bunx".`);
}

async function main(): Promise<void> {
  const cli = cac("ulis");

  cli
    .command("init", "Scaffold a .ulis/ folder in the current project (or ~/.ulis/ with --global)")
    .option("-g, --global", "Scaffold ~/.ulis/ instead of ./.ulis/")
    .action((options) => initCmd({ global: Boolean(options.global) }));

  cli
    .command("install", "Build configs from the ulis source tree and install them")
    .option("-g, --global", "Read ~/.ulis/ and install to ~/.claude/, ~/.codex/, ~/forge/, etc.")
    .option("-y, --yes", "Skip confirmation prompts (useful for CI)")
    .option("--source <path>", "Override the ulis source directory")
    .option("--target <platform>", "Only build/install the given platform(s) (comma-separated)")
    .option("--no-rebuild", "Skip the build step and install existing generated output")
    .option("--backup", "Back up existing platform dirs before overwriting")
    .option("--preset <names>", "Apply user-global or bundled preset(s) (comma-separated)")
    .option("--runner <name>", "Package runner used for extension installs (npx | bunx)")
    .option("--no-extensions", "Skip running entries from extensions.yaml")
    .action((options) =>
      installCmd({
        global: Boolean(options.global),
        yes: Boolean(options.yes),
        source: options.source,
        target: options.target,
        rebuild: options.rebuild !== false,
        backup: Boolean(options.backup),
        preset: options.preset,
        runner: parseRunner(options.runner),
        extensions: options.extensions !== false,
      }),
    );

  cli
    .command("build", "Build configs into <source>/generated/ without installing")
    .option("-g, --global", "Build from ~/.ulis/")
    .option("--source <path>", "Override the ulis source directory")
    .option("--target <platform>", "Only build the given platform(s) (comma-separated)")
    .option("--preset <names>", "Apply user-global or bundled preset(s) (comma-separated)")
    .action((options) =>
      buildCmd({
        global: Boolean(options.global),
        source: options.source,
        target: options.target,
        preset: options.preset,
      }),
    );

  cli
    .command("preset install [...names]", "Install selected presets without a base source")
    .option("-g, --global", "Install to ~/.claude/, ~/.codex/, ~/forge/, etc.")
    .option("-y, --yes", "Skip confirmation prompts (useful for CI)")
    .option("--target <platform>", "Only build/install the given platform(s) (comma-separated)")
    .option("--backup", "Back up existing platform dirs before overwriting")
    .option("--runner <name>", "Package runner used for extension installs (npx | bunx)")
    .option("--no-extensions", "Skip running entries from extensions.yaml")
    .action((names: string[] | undefined, options) =>
      presetInstallCmd(names, {
        global: Boolean(options.global),
        yes: Boolean(options.yes),
        target: options.target,
        backup: Boolean(options.backup),
        runner: parseRunner(options.runner),
        extensions: options.extensions !== false,
      }),
    );

  cli
    .command("preset [action]", "Manage presets (action: list, or use -l / --list)")
    .option("-l, --list", "List user-global and bundled presets")
    .action((action: string | undefined, options: { list?: boolean }) => {
      if (options.list || !action || action === "list") return presetListCmd();
      throw new Error(`Unknown preset action: "${action}". Available: list (or use --list)`);
    });

  cli.command("tui", "Launch the interactive terminal UI").action(() => tuiCmd());

  cli.help();
  cli.version(resolvePackageVersion());

  cli.parse(process.argv, { run: false });

  // No subcommand → print help
  if (!cli.matchedCommand) {
    cli.outputHelp();
    return;
  }

  await cli.runMatchedCommand();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
