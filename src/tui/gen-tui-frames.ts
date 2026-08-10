import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Captures a scripted walk through the TUI as terminal frames for the docs
 * landing-page animation (`docs/.vitepress/theme/tui-frames.json`).
 *
 * Run with Bun (`bun run gen:tui-frames`) — OpenTUI's renderer only initializes
 * under Bun's FFI.
 */
import { createTestRenderer } from "@opentui/core/testing";

import { TuiController } from "./controller.js";
import type { TuiState } from "./state.js";

const COLUMNS = 100;
const ROWS = 28;
const OUTPUT = "docs/.vitepress/theme/tui-frames.json";

/** One capture step: keys to press first, then how long the frame holds (ms). */
interface Step {
  readonly keys?: readonly string[];
  /** Mutates state directly for screens a real run would have to execute. */
  readonly mutate?: (state: TuiState) => void;
  readonly hold: number;
  readonly caption: string;
}

// The demo never executes a workflow (there is no `.ulis/` in this repo and the
// docs animation must be deterministic), so the running/result screens are
// staged by writing the same state a real run would produce.
const RUN_LOGS = [
  "Starting: Validate",
  "=== Validate ===",
  "[info] Reading .ulis/ (project source)",
  "[done] agents      4 parsed",
  "[done] skills      7 parsed",
  "[done] mcp         2 servers",
  "[done] permissions 18 rules",
  "[info] Resolving cross-references",
  "[done] 0 collisions, 0 unresolved references",
];

const STEPS: readonly Step[] = [
  { hold: 2000, caption: "start" },
  { keys: ["ARROW_DOWN"], hold: 500, caption: "flow: global" },
  { keys: ["ARROW_DOWN"], hold: 500, caption: "flow: custom source" },
  { keys: ["ARROW_UP"], hold: 350, caption: "flow: global" },
  { keys: ["ARROW_UP"], hold: 900, caption: "flow: project" },
  { keys: ["RETURN"], hold: 2000, caption: "plan" },
  { keys: ["ARROW_DOWN"], hold: 400, caption: "plan: base source" },
  { keys: ["ARROW_DOWN"], hold: 800, caption: "plan: platforms" },
  { keys: ["RETURN"], hold: 1600, caption: "platforms" },
  { keys: ["ARROW_DOWN"], hold: 450, caption: "platforms: move" },
  { keys: ["x"], hold: 900, caption: "platforms: toggle off" },
  { keys: ["x"], hold: 700, caption: "platforms: toggle on" },
  { keys: ["BACKSPACE"], hold: 1200, caption: "plan" },
  { keys: ["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"], hold: 500, caption: "plan: options" },
  { keys: ["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"], hold: 1100, caption: "plan: validate" },
  {
    mutate: (state) => {
      state.screen = "running";
      state.logs = RUN_LOGS.slice(0, 3);
      state.runningSpinnerFrame = 1;
    },
    hold: 700,
    caption: "running",
  },
  {
    mutate: (state) => {
      state.logs = RUN_LOGS.slice(0, 6);
      state.runningSpinnerFrame = 3;
    },
    hold: 700,
    caption: "running",
  },
  {
    mutate: (state) => {
      state.screen = "result";
      state.logs = RUN_LOGS;
      state.resultTitle = "Validate Complete";
      state.resultMessage = "Validate completed successfully.";
    },
    hold: 3200,
    caption: "result",
  },
];

type Rgba = { r: number; g: number; b: number; a: number };

function hex(color: Rgba): string {
  const channel = (value: number) =>
    Math.round(value <= 1 ? value * 255 : value)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** `[text, fg, bold, bg?]` — bg omitted when transparent. */
type Span = [string, string, 0 | 1, string?];

function captureFrame(setup: Awaited<ReturnType<typeof createTestRenderer>>): Span[][] {
  return setup.captureSpans().lines.map((line) => {
    const spans: Span[] = [];
    for (const span of line.spans) {
      const bg = span.bg.a > 0.01 ? hex(span.bg) : undefined;
      const bold: 0 | 1 = span.attributes & 1 ? 1 : 0;
      // Blank cells carry an arbitrary fg; flattening it lets runs merge.
      const fg = span.text.trim() === "" && bg == null ? "" : hex(span.fg);
      const previous = spans.at(-1);
      if (previous && previous[1] === fg && previous[2] === bold && previous[3] === bg) {
        previous[0] += span.text;
        continue;
      }
      spans.push(bg == null ? [span.text, fg, bold] : [span.text, fg, bold, bg]);
    }
    // drop trailing blank spans — the renderer pads every line to full width
    while (spans.length > 0 && spans.at(-1)?.[0].trim() === "" && spans.at(-1)?.length === 3) spans.pop();
    return spans;
  });
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "ulis-tui-frames-"));
  try {
    const setup = await createTestRenderer({ width: COLUMNS, height: ROWS });
    const controller = new TuiController(setup.renderer, {
      exit: () => {},
      preferencesPath: join(root, ".ulis-tui.json"),
      cwd: ".",
    });

    // Lines identical to the previous frame are stored as `0`; the player
    // carries the last-rendered line forward. Consecutive TUI screens differ by
    // a handful of rows, so this keeps the shipped JSON small.
    const frames: { hold: number; caption: string; lines: (Span[] | 0)[] }[] = [];
    let previous: string[] = [];
    for (const step of STEPS) {
      // One key per call — pressKeys() batches and the app only sees the last.
      for (const key of step.keys ?? []) await setup.mockInput.pressKeys([key], 40);
      step.mutate?.(controller.state);
      controller.render();
      await setup.renderOnce();

      const lines = captureFrame(setup);
      const encoded = lines.map((line, row) => (JSON.stringify(line) === previous[row] ? 0 : line));
      previous = lines.map((line) => JSON.stringify(line));
      frames.push({ hold: step.hold, caption: step.caption, lines: encoded });
    }

    writeFileSync(OUTPUT, `${JSON.stringify({ columns: COLUMNS, rows: ROWS, frames })}\n`, "utf-8");
    console.log(`Wrote ${OUTPUT} (${frames.length} frames, ${COLUMNS}x${ROWS})`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
process.exit(0);
