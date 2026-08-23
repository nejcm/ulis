/**
 * The view layer's vocabulary: `Tone`, `ViewTag`, `ViewRow`, `ViewPane`, `ViewInput`, `ScreenView`,
 * the minimum-terminal-size and split-column constants, and the control-hint strings every screen
 * quotes into its `controls` array. Pure data - no functions, no imports from elsewhere in
 * `tui/view/`. Every other file here depends on this one; this one depends on nothing in the
 * directory.
 */
/** Semantic color slots resolved to concrete colors by the theme. */
export type Tone = "default" | "muted" | "accent" | "success" | "warn" | "error";

export interface ViewTag {
  readonly text: string;
  readonly tone: Tone;
}

export type ViewRow =
  | { readonly kind: "blank" }
  | { readonly kind: "heading"; readonly text: string }
  | {
      readonly kind: "text";
      readonly text: string;
      readonly tone?: Tone;
      readonly indent?: number;
      readonly consent?: "warning" | "command";
    }
  | { readonly kind: "field"; readonly label: string; readonly value: string }
  | {
      readonly kind: "option";
      /** Cursor index this row maps to; used by keyboard focus and click routing. */
      readonly index: number;
      readonly selected: boolean;
      readonly label: string;
      readonly value?: string;
      readonly description?: string;
      readonly checked?: boolean;
    }
  | { readonly kind: "log"; readonly text: string; readonly tag?: ViewTag };

export interface ViewPane {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly ViewRow[];
  readonly grow: number;
}

export interface ViewInput {
  readonly value: string;
  readonly placeholder: string;
  readonly focused: boolean;
}

export interface ScreenView {
  readonly title: string;
  readonly subtitle: string;
  readonly breadcrumbs: readonly string[];
  readonly panes: readonly ViewPane[];
  readonly input?: ViewInput;
  readonly notice: { readonly text: string; readonly tone: Tone };
  readonly controls: readonly string[];
}

/** Terminal must be at least this large before the app renders its shell. */
export const MIN_COLUMNS = 50;
export const MIN_ROWS = 16;
/** At or above this width the plan screen splits into two side-by-side panes. */
export const SPLIT_COLUMNS = 96;

export const NAV_CONTROLS = ["j/k or arrows: move", "Enter: select", "Backspace: back", "q: quit"];
export const REVIEW_CONTROLS = ["PgDn: review commands", "Enter: select", "Bksp: back", "q: quit"];
export const REVIEW_MOUSE_CONTROL = "wheel: review";
export const TOGGLE_CONTROLS = ["j/k or arrows: move", "Enter/x/space: toggle", "Backspace: back", "q: quit"];
export const MOUSE_CONTROL = "mouse: click rows, wheel scrolls";
