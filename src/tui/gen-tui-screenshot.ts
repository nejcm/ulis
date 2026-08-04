import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Renders a deterministic ULIS TUI frame to `tui.svg` for the README.
 *
 * Run with Bun (`bun src/tui/gen-tui-screenshot.ts`) — OpenTUI's renderer only
 * initializes under Bun's FFI.
 */
import { createTestRenderer } from "@opentui/core/testing";

import { TuiController } from "./controller.js";

const COLUMNS = 100;
const ROWS = 28;
const CELL_WIDTH = 8.4;
const CELL_HEIGHT = 18;
const PADDING = 12;
const BACKGROUND = "#0d1117";
const FONT = "ui-monospace, 'SF Mono', 'Cascadia Mono', 'DejaVu Sans Mono', monospace";

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function hex(color: { r: number; g: number; b: number; a: number }): string {
  const channel = (value: number) =>
    Math.round(value <= 1 ? value * 255 : value)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function isOpaque(color: { a: number }): boolean {
  return color.a > 0.01;
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "ulis-tui-screenshot-"));
  try {
    const setup = await createTestRenderer({ width: COLUMNS, height: ROWS });
    const controller = new TuiController(setup.renderer, {
      exit: () => {},
      preferencesPath: join(root, ".ulis-tui.json"),
      cwd: ".",
    });
    controller.render();
    await setup.renderOnce();

    // Start -> "Update this project" -> the editable plan.
    await setup.mockInput.pressKeys(["RETURN"], 60);
    controller.render();
    await setup.renderOnce();

    const frame = setup.captureSpans();
    const width = COLUMNS * CELL_WIDTH + PADDING * 2;
    const height = ROWS * CELL_HEIGHT + PADDING * 2;

    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" role="img" aria-label="ulis tui">`,
      `<rect width="100%" height="100%" rx="8" fill="${BACKGROUND}"/>`,
      `<g font-family="${FONT}" font-size="13">`,
    ];

    frame.lines.forEach((line, row) => {
      let column = 0;
      const y = PADDING + row * CELL_HEIGHT;
      for (const span of line.spans) {
        const x = PADDING + column * CELL_WIDTH;
        if (isOpaque(span.bg)) {
          parts.push(
            `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(span.width * CELL_WIDTH).toFixed(1)}" height="${CELL_HEIGHT}" fill="${hex(span.bg)}"/>`,
          );
        }
        if (span.text.trim() !== "") {
          const weight = span.attributes & 1 ? ' font-weight="700"' : "";
          // `textLength` pins every span to its terminal column regardless of the
          // monospace font the viewer happens to have.
          parts.push(
            `<text x="${x.toFixed(1)}" y="${(y + CELL_HEIGHT - 5).toFixed(1)}" fill="${hex(span.fg)}" xml:space="preserve" textLength="${(span.width * CELL_WIDTH).toFixed(1)}" lengthAdjust="spacingAndGlyphs"${weight}>${escapeXml(span.text)}</text>`,
          );
        }
        column += span.width;
      }
    });

    parts.push("</g></svg>\n");
    writeFileSync("tui.svg", parts.join("\n"), "utf-8");
    console.log(`Wrote tui.svg (${COLUMNS}x${ROWS})`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
process.exit(0);
