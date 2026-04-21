import { ProcessTerminal, Text, VStack, cel, type Color } from "@cel-tui/core";

import { runBuild, type Logger } from "./build.js";
import { runInstall } from "./install.js";
import { PLATFORMS, PLATFORM_DESCRIPTIONS, PLATFORM_LABELS, type Platform } from "./platforms.js";
import { resolveWorkflowPlan, toggleAllPlatformSelections, togglePlatformSelection } from "./workflow.js";

type Screen = "welcome" | "generate" | "install" | "options" | "running" | "done" | "error";

interface UiLine {
  readonly text: string;
  readonly fgColor?: Color;
  readonly bgColor?: Color;
  readonly bold?: boolean;
  readonly indent?: number;
}

const CARD_MAX_WIDTH = 96;
const TITLE = "AI Config Studio";
const SUBTITLE = "A guided TUI for generating and installing platform configs.";

const state = {
  screen: "welcome" as Screen,
  cursor: 0,
  generateTargets: [...PLATFORMS] as Platform[],
  installTargets: [...PLATFORMS] as Platform[],
  backup: true,
  logs: [] as string[],
  notice: "",
  lastPlan: resolveWorkflowPlan(PLATFORMS, PLATFORMS),
};

function main(): void {
  cel.init(new ProcessTerminal());
  cel.viewport(renderApp);
}

function renderApp() {
  return VStack(
    {
      width: "100%",
      height: "100%",
      padding: { x: 1, y: 1 },
      justifyContent: "start",
      alignItems: "center",
      overflow: "scroll",
      scrollbar: true,
      bgColor: "color00",
      fgColor: "color07",
      focusable: true,
      onKeyPress: (key) => {
        handleKey(key);
      },
    },
    [renderScreen()],
  );
}

function renderScreen() {
  switch (state.screen) {
    case "welcome":
      return renderCard(TITLE, SUBTITLE, [
        { text: "Welcome", fgColor: "color06", bold: true },
        { text: "" },
        { text: "Build exactly the platforms you want, then install only the ones you choose." },
        { text: "This flow reuses the repo's native build and install logic under the hood." },
        { text: "" },
        { text: "Features", fgColor: "color06", bold: true },
        { text: "  - Multi-platform generation for OpenCode, Claude Code, Codex, Cursor, and ForgeCode" },
        { text: "  - Independent install selection, with optional backup protection" },
        { text: "  - Live progress log while the workflow runs" },
        { text: "" },
        { text: "Controls", fgColor: "color06", bold: true },
        { text: "  - Move with j/k or arrow keys" },
        { text: "  - Toggle with enter, x, or space" },
        { text: "  - Press q to quit at any time before execution starts" },
        { text: "" },
        { text: "Press Enter to start.", fgColor: "color00", bgColor: "color06", bold: true },
      ]);
    case "generate":
      return renderSelectionScreen(
        "Choose generation targets",
        "Select which platform configs to build into generated/.",
        state.generateTargets,
        state.notice,
        "Continue to install targets",
        "Back to welcome",
      );
    case "install":
      return renderSelectionScreen(
        "Choose install targets",
        "Select which generated configs should be copied into your home directory.",
        state.installTargets,
        state.notice,
        "Continue to workflow options",
        "Back to generation targets",
      );
    case "options":
      return renderOptionsScreen();
    case "running":
      return renderCard("Running workflow", "Build and install are in progress.", [
        { text: "Progress", fgColor: "color06", bold: true },
        { text: "" },
        ...renderLogLines(),
      ]);
    case "done":
      return renderCard("Workflow complete", "Generation and install finished successfully.", [
        { text: `Built: ${formatSelection(state.lastPlan.buildTargets)}` },
        { text: `Installed: ${formatSelection(state.lastPlan.installTargets)}` },
        { text: "" },
        { text: "Recent log output", fgColor: "color06", bold: true },
        { text: "" },
        ...renderLogLines(),
        { text: "" },
        { text: "Press Enter or q to exit.", fgColor: "color00", bgColor: "color06", bold: true },
      ]);
    case "error":
      return renderCard("Workflow failed", "The workflow stopped before completion.", [
        { text: state.notice || "An unknown error occurred.", fgColor: "color01", bold: true },
        { text: "" },
        { text: "Recent log output", fgColor: "color06", bold: true },
        { text: "" },
        ...renderLogLines(),
        { text: "" },
        {
          text: "Press Enter to go back to options, or q to quit.",
          fgColor: "color00",
          bgColor: "color03",
          bold: true,
        },
      ]);
  }
}

function renderSelectionScreen(
  title: string,
  subtitle: string,
  selected: readonly Platform[],
  notice: string,
  continueLabel: string,
  backLabel: string,
) {
  const allSelected = selected.length === PLATFORMS.length;
  const lines: UiLine[] = [
    { text: `Selected: ${formatSelection(selected)}`, fgColor: "color06", bold: true },
    { text: "" },
  ];

  lines.push({
    text: `${state.cursor === 0 ? ">" : " "} [${allSelected ? "x" : " "}] All platforms`,
    bgColor: state.cursor === 0 ? "color08" : undefined,
    fgColor: state.cursor === 0 ? "color07" : undefined,
    bold: state.cursor === 0,
  });
  lines.push({
    text: "Select every supported platform in one action.",
    bgColor: state.cursor === 0 ? "color08" : undefined,
    fgColor: state.cursor === 0 ? "color07" : "color08",
    indent: 4,
  });

  for (let index = 0; index < PLATFORMS.length; index++) {
    const platform = PLATFORMS[index];
    const active = selected.includes(platform);
    const focused = state.cursor === index + 1;
    const prefix = focused ? ">" : " ";
    const checkbox = active ? "[x]" : "[ ]";
    lines.push({
      text: `${prefix} ${checkbox} ${PLATFORM_LABELS[platform]}`,
      bgColor: focused ? "color08" : undefined,
      fgColor: focused ? "color07" : undefined,
      bold: focused,
    });
    lines.push({
      text: PLATFORM_DESCRIPTIONS[platform],
      bgColor: focused ? "color08" : undefined,
      fgColor: focused ? "color07" : "color08",
      indent: 4,
    });
  }

  lines.push({ text: "" });
  lines.push({
    text: `${state.cursor === PLATFORMS.length + 1 ? ">" : " "} ${continueLabel}`,
    bgColor: state.cursor === PLATFORMS.length + 1 ? "color08" : undefined,
    bold: state.cursor === PLATFORMS.length + 1,
  });
  lines.push({
    text: `${state.cursor === PLATFORMS.length + 2 ? ">" : " "} ${backLabel}`,
    bgColor: state.cursor === PLATFORMS.length + 2 ? "color08" : undefined,
    bold: state.cursor === PLATFORMS.length + 2,
  });
  lines.push({ text: "" });
  lines.push({
    text: notice || "Tip: install selection can differ from generation selection.",
    fgColor: notice ? "color03" : "color08",
  });

  return renderCard(title, subtitle, lines);
}

function renderOptionsScreen() {
  const plan = resolveWorkflowPlan(state.generateTargets, state.installTargets);
  const lines: UiLine[] = [
    { text: `Will build: ${formatSelection(plan.buildTargets)}`, fgColor: "color06", bold: true },
    { text: `Will install: ${formatSelection(plan.installTargets)}` },
    { text: "" },
    {
      text: `${state.cursor === 0 ? ">" : " "} [${state.backup ? "x" : " "}] Backup existing configs before install`,
      bgColor: state.cursor === 0 ? "color08" : undefined,
      bold: state.cursor === 0,
    },
    {
      text: `${state.cursor === 1 ? ">" : " "} Start workflow`,
      bgColor: state.cursor === 1 ? "color08" : undefined,
      bold: state.cursor === 1,
    },
    {
      text: `${state.cursor === 2 ? ">" : " "} Back to install targets`,
      bgColor: state.cursor === 2 ? "color08" : undefined,
      bold: state.cursor === 2,
    },
    { text: "" },
    {
      text:
        state.notice ||
        "The final build set is the union of generation and install selections so installs are always fresh.",
      fgColor: state.notice ? "color03" : "color08",
    },
  ];

  return renderCard("Review workflow", "Confirm the plan before execution starts.", lines);
}

function renderCard(title: string, subtitle: string, lines: readonly UiLine[]) {
  return VStack(
    {
      width: "92%",
      maxWidth: CARD_MAX_WIDTH,
      bgColor: "color00",
      fgColor: "color07",
      gap: 0,
      alignItems: "stretch",
    },
    [
      VStack(
        {
          width: "100%",
          bgColor: "color06",
          fgColor: "color00",
          padding: { x: 1 },
          alignItems: "stretch",
        },
        [Text(title, { bold: true, wrap: "word" })],
      ),
      VStack(
        {
          width: "100%",
          bgColor: "color08",
          fgColor: "color07",
          padding: { x: 1 },
          alignItems: "stretch",
        },
        [Text(subtitle, { wrap: "word" })],
      ),
      ...lines.map((line) =>
        VStack(
          {
            width: "100%",
            fgColor: line.fgColor,
            bgColor: line.bgColor,
            padding: { x: 1 + (line.indent ?? 0) },
            alignItems: "stretch",
          },
          [
            Text(line.text || " ", {
              bold: line.bold,
              wrap: "word",
            }),
          ],
        ),
      ),
      VStack(
        {
          width: "100%",
          fgColor: "color08",
          padding: { x: 1 },
          alignItems: "stretch",
        },
        [Text("Controls: j/k or arrows to move, Enter to continue, x/space to toggle, q to quit", { wrap: "word" })],
      ),
    ],
  );
}

function renderLogLines(): UiLine[] {
  const recent = state.logs.slice(-12);
  if (recent.length === 0) {
    return [{ text: "Waiting for log output...", fgColor: "color08" }];
  }

  return recent.map((entry) => ({ text: entry }));
}

function handleKey(key: string): void {
  if (state.screen === "running") {
    return;
  }

  if (isAnyKey(key, "ctrl+c", "q")) {
    exitApp(0);
    return;
  }

  switch (state.screen) {
    case "welcome":
      if (isConfirmKey(key)) {
        state.screen = "generate";
        state.cursor = 0;
        state.notice = "";
        cel.render();
      }
      break;
    case "generate":
      handleSelectionKey("generate", key);
      break;
    case "install":
      handleSelectionKey("install", key);
      break;
    case "options":
      handleOptionsKey(key);
      break;
    case "done":
      if (isConfirmKey(key)) {
        exitApp(0);
      }
      break;
    case "error":
      if (isConfirmKey(key)) {
        state.screen = "options";
        state.cursor = 1;
        state.notice = "";
        cel.render();
      }
      break;
  }
}

function handleSelectionKey(screen: "generate" | "install", key: string): void {
  const lastIndex = PLATFORMS.length + 2;

  if (isUpKey(key)) {
    state.cursor = (state.cursor + lastIndex) % (lastIndex + 1);
    cel.render();
    return;
  }

  if (isDownKey(key)) {
    state.cursor = (state.cursor + 1) % (lastIndex + 1);
    cel.render();
    return;
  }

  if (state.cursor === 0 && isToggleKey(key)) {
    if (screen === "generate") {
      state.generateTargets = toggleAllPlatformSelections(state.generateTargets);
    } else {
      state.installTargets = toggleAllPlatformSelections(state.installTargets);
    }
    state.notice = "";
    cel.render();
    return;
  }

  if (state.cursor > 0 && state.cursor <= PLATFORMS.length && isToggleKey(key)) {
    const platform = PLATFORMS[state.cursor - 1];
    if (screen === "generate") {
      state.generateTargets = togglePlatformSelection(state.generateTargets, platform);
    } else {
      state.installTargets = togglePlatformSelection(state.installTargets, platform);
    }
    state.notice = "";
    cel.render();
    return;
  }

  if (!isConfirmKey(key)) {
    return;
  }

  if (state.cursor === PLATFORMS.length + 1) {
    state.screen = screen === "generate" ? "install" : "options";
    state.cursor = 0;
    state.notice = "";
    cel.render();
    return;
  }

  if (state.cursor === PLATFORMS.length + 2) {
    state.screen = screen === "generate" ? "welcome" : "generate";
    state.cursor = 0;
    state.notice = "";
    cel.render();
  }
}

function handleOptionsKey(key: string): void {
  const lastIndex = 2;

  if (isUpKey(key)) {
    state.cursor = (state.cursor + lastIndex) % (lastIndex + 1);
    cel.render();
    return;
  }

  if (isDownKey(key)) {
    state.cursor = (state.cursor + 1) % (lastIndex + 1);
    cel.render();
    return;
  }

  if (!isToggleKey(key) && !isConfirmKey(key)) {
    return;
  }

  if (state.cursor === 0) {
    state.backup = !state.backup;
    state.notice = "";
    cel.render();
    return;
  }

  if (state.cursor === 1) {
    const plan = resolveWorkflowPlan(state.generateTargets, state.installTargets);
    if (plan.buildTargets.length === 0) {
      state.notice = "Select at least one platform to generate or install.";
      cel.render();
      return;
    }

    state.lastPlan = plan;
    state.logs = [
      `Plan build: ${formatSelection(plan.buildTargets)}`,
      `Plan install: ${formatSelection(plan.installTargets)}`,
    ];
    state.notice = "";
    state.screen = "running";
    cel.render();
    setTimeout(() => {
      void executeWorkflow(plan);
    }, 0);
    return;
  }

  state.screen = "install";
  state.cursor = 0;
  state.notice = "";
  cel.render();
}

async function executeWorkflow(plan: ReturnType<typeof resolveWorkflowPlan>): Promise<void> {
  try {
    const logger = createUiLogger();
    const { resolveSource } = await import("./utils/resolve-source.js");
    const { sourceDir, destBase } = resolveSource({ global: true });

    if (plan.buildTargets.length > 0) {
      runBuild({ targets: plan.buildTargets, sourceDir, logger });
    }

    if (plan.installTargets.length > 0) {
      runInstall({
        platforms: plan.installTargets,
        backup: state.backup,
        sourceDir,
        destBase,
        logger,
      });
    }

    state.screen = "done";
    cel.render();
  } catch (error) {
    state.notice = error instanceof Error ? error.message : String(error);
    state.screen = "error";
    cel.render();
  }
}

function createUiLogger(): Logger {
  return {
    header: (message) => pushLog(`=== ${message} ===`),
    info: (message) => pushLog(`[info] ${message}`),
    success: (message) => pushLog(`[done] ${message}`),
    warn: (message) => pushLog(`[warn] ${message}`),
    error: (message) => pushLog(`[error] ${message}`),
    dim: (message) => pushLog(`      ${message}`),
  };
}

function pushLog(message: string): void {
  state.logs = [...state.logs, message].slice(-40);
  cel.render();
}

function formatSelection(selected: readonly Platform[]): string {
  return selected.length > 0 ? selected.map((platform) => PLATFORM_LABELS[platform]).join(", ") : "none";
}

function isAnyKey(key: string, ...candidates: readonly string[]): boolean {
  return candidates.includes(key);
}

function isConfirmKey(key: string): boolean {
  return isAnyKey(key, "enter");
}

function isToggleKey(key: string): boolean {
  return isAnyKey(key, "enter", "x", " ");
}

function isUpKey(key: string): boolean {
  return isAnyKey(key, "k", "up", "arrowup");
}

function isDownKey(key: string): boolean {
  return isAnyKey(key, "j", "down", "arrowdown");
}

function exitApp(code: number): void {
  cel.stop();
  process.exit(code);
}

export function runTui(): void {
  main();
}

if (import.meta.main) {
  main();
}
