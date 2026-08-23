/**
 * Layout primitives shared by every screen: row/pane builders (`pane`, `field`, `option`,
 * `notice`), simple formatters (`onOff`, `formatPlatforms`), column-width math for narrow
 * terminals (`displayWidth`, `middleElide`), and `splitLogTag` for the running/result log view.
 * Deliberately has no opinion on any one screen's content - `types.ts` is this module's only
 * dependency within `tui/view/`, and every `screens-*.ts` file depends on this one, never the
 * reverse. Consent-surface formatting (the command line the trust gate displays) lives with the
 * review screens instead, in `screens-review.ts`.
 */
import { PLATFORM_LABELS, type Platform } from "../../platforms.js";
import type { TuiState } from "../state-model.js";
import type { Tone, ViewPane, ViewRow, ViewTag } from "./types.js";

export function displayWidth(value: string): number {
  return Bun.stringWidth(value);
}

export function middleElide(value: string, columns: number): string {
  if (displayWidth(value) <= columns) return value;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(
    ({ segment }) => segment,
  );
  const kept = columns - 1;
  return `${takeColumns(graphemes, Math.ceil(kept / 2))}…${takeColumns(graphemes, Math.floor(kept / 2), true)}`;
}

function takeColumns(characters: string[], columns: number, fromEnd = false): string {
  const kept: string[] = [];
  let width = 0;
  for (
    let index = fromEnd ? characters.length - 1 : 0;
    index >= 0 && index < characters.length;
    index += fromEnd ? -1 : 1
  ) {
    const character = characters[index]!;
    const nextWidth = displayWidth(character);
    if (width + nextWidth > columns) break;
    kept.push(character);
    width += nextWidth;
  }
  return fromEnd ? kept.reverse().join("") : kept.join("");
}

export function pane(id: string, title: string, rows: readonly ViewRow[], grow = 1): ViewPane {
  return { id, title, rows, grow };
}

export function field(label: string, value: string): ViewRow {
  return { kind: "field", label, value };
}

export function option(
  state: TuiState,
  index: number,
  label: string,
  extras: { value?: string; description?: string; checked?: boolean } = {},
): ViewRow {
  return {
    kind: "option",
    index,
    selected: state.cursor === index,
    label,
    ...extras,
  };
}

export function notice(state: TuiState, fallback: string): { readonly text: string; readonly tone: Tone } {
  return state.notice ? { text: state.notice, tone: "warn" } : { text: fallback, tone: "muted" };
}

export function onOff(value: boolean): string {
  return value ? "on" : "off";
}

export function formatPlatforms(platforms: readonly Platform[]): string {
  return platforms.length > 0 ? platforms.map((platform) => PLATFORM_LABELS[platform]).join(", ") : "none";
}

export function splitLogTag(entry: string): { readonly text: string; readonly tag?: ViewTag } {
  const match = entry.match(/^\[(info|done|warn|error)\]\s*([\s\S]*)$/u);
  if (!match) return { text: entry };

  const [, level, text] = match;
  const tone = { info: "accent", done: "success", warn: "warn", error: "error" }[level as string] as Tone;
  return { text: text ?? "", tag: { text: `[${level}]`, tone } };
}
