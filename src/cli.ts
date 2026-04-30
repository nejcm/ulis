import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cac } from "cac";

import { buildCmd } from "./commands/build.js";
import { initCmd } from "./commands/init.js";
import { installCmd } from "./commands/install.js";
import { presetListCmd } from "./commands/preset.js";
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
    .option("--preset <names>", "Apply preset(s) from ~/.ulis/presets/ (comma-separated)")
    .action((options) =>
      installCmd({
        global: Boolean(options.global),
        yes: Boolean(options.yes),
        source: options.source,
        target: options.target,
        rebuild: options.rebuild !== false,
        backup: Boolean(options.backup),
        preset: options.preset,
      }),
    );

  cli
    .command("build", "Build configs into <source>/generated/ without installing")
    .option("-g, --global", "Build from ~/.ulis/")
    .option("--source <path>", "Override the ulis source directory")
    .option("--target <platform>", "Only build the given platform(s) (comma-separated)")
    .option("--preset <names>", "Apply preset(s) from ~/.ulis/presets/ (comma-separated)")
    .action((options) =>
      buildCmd({
        global: Boolean(options.global),
        source: options.source,
        target: options.target,
        preset: options.preset,
      }),
    );

  cli
    .command("preset [action]", "Manage presets (action: list, or use -l / --list)")
    .option("-l, --list", "List all presets under ~/.ulis/presets/")
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
