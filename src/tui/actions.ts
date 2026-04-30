import { analyzeProject, runBuild, type Logger } from "../build.js";
import { initCmd } from "../commands/init.js";
import { runInstall } from "../install.js";
import { planSource, selectedPresets, type TuiAction, type TuiState } from "./state.js";

export function runTuiAction(state: TuiState, action: Exclude<TuiAction, "init">, logger: Logger): void {
  const planned = planSource(state);
  const presets = selectedPresets(state);

  if (action === "validate") {
    logger.header("ULIS Validate");
    logger.info(`Source: ${planned.sourceDir}`);
    if (presets.length > 0) logger.info(`Presets: ${presets.map((preset) => preset.name).join(", ")}`);
    const analysis = analyzeProject({ sourceDir: planned.sourceDir, presets, logger });
    logger.success(
      `Validated ${analysis.project.agents.length} agents, ${analysis.project.skills.length} skills, ${
        Object.keys(analysis.project.mcp.servers).length
      } MCP servers`,
    );
    return;
  }

  if (action === "build") {
    runBuild({ sourceDir: planned.sourceDir, targets: state.platforms, presets, logger });
    return;
  }

  runInstall({
    sourceDir: planned.sourceDir,
    destBase: planned.destBase,
    globalInstall: planned.globalInstall,
    platforms: state.platforms,
    backup: state.backup,
    rebuild: state.rebuild,
    logger,
    presets,
  });
}

export async function initializeMissingSource(state: TuiState, logger: Logger): Promise<void> {
  if (state.sourceMode === "custom") {
    throw new Error("Custom sources cannot be initialized from the TUI.");
  }

  logger.header("ULIS Init");
  await initCmd({ global: state.sourceMode === "global", logger });
}
