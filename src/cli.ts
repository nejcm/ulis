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
    .option("-g, --global", "Read ~/.ulis/ and install to ~/.claude/, ~/.codex/, ~/.forge/, etc.")
    .option("-y, --yes", "Skip confirmation prompts (useful for CI)")
    .option("--source <path>", "Override the ulis source directory")
    .option("--target <platforms>", "Only build/install the given platform(s) (comma-separated)")
    .option("--skip-rebuild", "Skip the build step and install existing generated output")
    .option("--backup", "Back up existing platform dirs before overwriting")
    .option("--preset <names>", "Apply user-global or bundled preset(s) (comma-separated)")
    .option("--runner <npx|bunx>", "Package runner used for extension installs (npx | bunx)")
    .option("--skip-extensions", "Skip running entries from extensions.yaml")
    .option("--skip-external-skills", "Skip installing external skills from skills.yaml")
    .action((options) =>
      installCmd({
        global: Boolean(options.global),
        yes: Boolean(options.yes),
        source: options.source,
        target: options.target,
        rebuild: !options.skipRebuild,
        backup: Boolean(options.backup),
        preset: options.preset,
        runner: parseRunner(options.runner),
        extensions: !options.skipExtensions,
        skipExternalSkills: Boolean(options.skipExternalSkills),
      }),
    );

  cli
    .command("build", "Build configs into <source>/generated/ without installing")
    .option("-g, --global", "Build from ~/.ulis/")
    .option("--source <path>", "Override the ulis source directory")
    .option("--target <platforms>", "Only build the given platform(s) (comma-separated)")
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
    .command("preset [...args]", "Manage presets (actions: list, install)")
    .option("-l, --list", "List user-global and bundled presets")
    .option("-g, --global", "Install presets to ~/.claude/, ~/.codex/, ~/.forge/, etc.")
    .option("-y, --yes", "Skip preset install confirmation prompts (useful for CI)")
    .option("--target <platforms>", "Only install the given platform(s) for preset install (comma-separated)")
    .option("--backup", "Back up existing platform dirs before preset install")
    .option("--runner <npx|bunx>", "Package runner used for preset extension installs (npx | bunx)")
    .option("--skip-extensions", "Skip running entries from preset extensions.yaml")
    .option("--skip-external-skills", "Skip installing external skills from preset skills.yaml")
    .action((args: string[] | undefined, options) => {
      const [action, ...names] = args ?? [];
      if (options.list || action == null || action === "list") return presetListCmd();
      if (action === "install") {
        return presetInstallCmd(names, {
          global: Boolean(options.global),
          yes: Boolean(options.yes),
          target: options.target,
          backup: Boolean(options.backup),
          runner: parseRunner(options.runner),
          extensions: !options.skipExtensions,
          skipExternalSkills: Boolean(options.skipExternalSkills),
        });
      }
      throw new Error(`Unknown preset action: "${action}". Available: list, install`);
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
