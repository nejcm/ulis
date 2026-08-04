import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent,
  type PasteEvent,
  type Renderable,
} from "@opentui/core";

import {
  appendTextInput,
  applyCustomSourceTextInputChange,
  handleCustomSourceTextInputKey,
  handleTuiKey,
  type TuiEffect,
  type TuiState,
} from "./state.js";
import { THEME, toneColor } from "./theme.js";
import {
  buildScreenView,
  MIN_COLUMNS,
  MIN_ROWS,
  SPLIT_COLUMNS,
  type ScreenView,
  type ViewPane,
  type ViewRow,
} from "./view.js";

const ULIS_LOGO = [
  " _   _ _     ___ ____  ",
  "| | | | |   |_ _/ ___| ",
  "| | | | |    | |\\___ \\ ",
  "| |_| | |___ | | ___) |",
  " \\___/|_____|___|____/ ",
].join("\n");
const LOGO_HEIGHT = 5;
const LOGO_SPACING = 2;
const COMPACT_HEADER_HEIGHT = 3;
const LOGO_HEADER_HEIGHT = LOGO_HEIGHT + LOGO_SPACING + 2;

export interface TuiAppOptions {
  readonly state: TuiState;
  /** Runs an effect produced by a key press or click. */
  readonly onEffect: (effect: TuiEffect) => void;
  /** Called after every state mutation so preferences can be persisted. */
  readonly onStateChanged?: () => void;
  /** Supplies clipboard text for the explicit Ctrl+V paste path. */
  readonly readClipboard?: () => string;
  /** Overrides the working directory used in rendered plan paths. */
  readonly cwd?: string;
}

/**
 * Imperative OpenTUI shell for the ULIS TUI.
 *
 * The app owns only presentation and input routing; every state transition goes
 * through the shared handlers in `state.ts`, so keyboard and mouse cannot drift
 * apart.
 */
export class TuiApp {
  private readonly renderer: CliRenderer;
  private readonly options: TuiAppOptions;

  private readonly root: BoxRenderable;
  private readonly header: BoxRenderable;
  private readonly headerTitle: TextRenderable;
  private readonly headerCrumbs: TextRenderable;
  private readonly inputHost: BoxRenderable;
  private readonly inputField: InputRenderable;
  private readonly body: BoxRenderable;
  private readonly noticeText: TextRenderable;
  private readonly controlsText: TextRenderable;
  private readonly resizeHint: BoxRenderable;

  private paneScrolls = new Map<string, ScrollBoxRenderable>();
  private lastPaneSignature = "";
  private disposed = false;

  constructor(renderer: CliRenderer, options: TuiAppOptions) {
    this.renderer = renderer;
    this.options = options;

    this.root = new BoxRenderable(renderer, {
      id: "ulis-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
    });

    // Keep the logo's five rows and the breadcrumbs in separate fixed-height
    // renderables so wrapping cannot push them into each other.
    this.headerTitle = new TextRenderable(renderer, {
      id: "ulis-header-title",
      content: ULIS_LOGO,
      fg: THEME.brand,
      attributes: 1,
      width: "100%",
      height: LOGO_HEIGHT + LOGO_SPACING,
      flexShrink: 0,
      wrapMode: "none",
      truncate: true,
    });
    this.headerCrumbs = new TextRenderable(renderer, {
      id: "ulis-header-crumbs",
      content: "",
      fg: THEME.muted,
      width: "100%",
      height: 1,
      flexShrink: 0,
      wrapMode: "none",
      truncate: true,
    });

    this.header = new BoxRenderable(renderer, {
      id: "ulis-header",
      width: "100%",
      height: LOGO_HEADER_HEIGHT,
      flexShrink: 0,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      border: ["bottom"],
      borderColor: THEME.border,
    });
    this.header.add(this.headerTitle);
    this.header.add(this.headerCrumbs);

    this.inputHost = new BoxRenderable(renderer, {
      id: "ulis-input-host",
      width: "100%",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      visible: false,
      border: false,
    });
    this.inputField = new InputRenderable(renderer, {
      id: "ulis-input",
      width: "100%",
      backgroundColor: "transparent",
      textColor: THEME.text,
      focusedTextColor: THEME.text,
      placeholderColor: THEME.muted,
      placeholder: "",
    });
    this.inputHost.add(this.inputField);

    this.body = new BoxRenderable(renderer, {
      id: "ulis-body",
      width: "100%",
      flexGrow: 1,
      minHeight: 0,
      flexDirection: "row",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      gap: 1,
    });

    this.noticeText = new TextRenderable(renderer, {
      id: "ulis-notice",
      content: "",
      fg: THEME.muted,
      wrapMode: "word",
    });
    const noticeBox = new BoxRenderable(renderer, {
      id: "ulis-notice-box",
      width: "100%",
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
    });
    noticeBox.add(this.noticeText);

    this.controlsText = new TextRenderable(renderer, {
      id: "ulis-controls",
      content: "",
      fg: THEME.muted,
      wrapMode: "word",
    });
    const controlsBox = new BoxRenderable(renderer, {
      id: "ulis-controls-box",
      width: "100%",
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
      border: ["top"],
      borderColor: THEME.border,
    });
    controlsBox.add(this.controlsText);

    this.resizeHint = new BoxRenderable(renderer, {
      id: "ulis-resize-hint",
      width: "100%",
      height: "100%",
      visible: false,
      alignItems: "center",
      justifyContent: "center",
      padding: 1,
    });
    this.resizeHint.add(
      new TextRenderable(renderer, {
        id: "ulis-resize-hint-text",
        content: `Terminal too small. Resize to at least ${MIN_COLUMNS}x${MIN_ROWS}.`,
        fg: THEME.warn,
        wrapMode: "word",
      }),
    );

    this.root.add(this.header);
    this.root.add(this.inputHost);
    this.root.add(this.body);
    this.root.add(noticeBox);
    this.root.add(controlsBox);

    renderer.root.add(this.root);
    renderer.root.add(this.resizeHint);

    this.attachInputHandlers();
    this.update();
  }

  /** Rebuilds the visible frame from the current state. */
  update(): void {
    if (this.disposed) return;

    const tooSmall = this.renderer.width < MIN_COLUMNS || this.renderer.height < MIN_ROWS;
    this.root.visible = !tooSmall;
    this.resizeHint.visible = tooSmall;
    if (tooSmall) {
      this.renderer.requestRender();
      return;
    }

    const view = buildScreenView(this.options.state, this.options.cwd);

    const showLogo = view.title === "ULIS";
    this.headerTitle.content = showLogo ? ULIS_LOGO : view.title;
    this.headerTitle.height = showLogo ? LOGO_HEIGHT + LOGO_SPACING : 1;
    this.header.height = showLogo ? LOGO_HEADER_HEIGHT : COMPACT_HEADER_HEIGHT;
    this.headerCrumbs.content = `${view.breadcrumbs.join("  >  ")}   -   ${view.subtitle}`;
    this.noticeText.content = view.notice.text;
    this.noticeText.fg = toneColor(view.notice.tone);
    this.controlsText.content = view.controls.join("   ");

    this.syncInput(view);
    this.syncPanes(view);

    this.renderer.requestRender();
  }

  /** Detaches every renderable this app created. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.keyInput.off("keypress", this.onKeyPress);
    this.renderer.keyInput.off("paste", this.onPaste);
    this.root.destroyRecursively();
    this.resizeHint.destroyRecursively();
  }

  private attachInputHandlers(): void {
    this.renderer.keyInput.on("keypress", this.onKeyPress);
    this.renderer.keyInput.on("paste", this.onPaste);
    this.inputField.on(InputRenderableEvents.INPUT, (value: string) => {
      const { state } = this.options;
      if (!isPathInputScreen(state) || state.cursor !== 0) return;
      if (state.textInput === value) return;
      applyCustomSourceTextInputChange(state, value);
      this.commit();
    });
  }

  private readonly onKeyPress = (event: KeyEvent): void => {
    if (this.disposed) return;
    const key = keyEventToKey(event);
    if (key == null) return;

    // Ctrl+C always exits, including while the path editor holds focus.
    if (key === "ctrl+c") {
      event.preventDefault();
      this.options.onEffect({ type: "exit", code: 0 });
      return;
    }

    if (this.isTooSmall()) {
      event.preventDefault();
      return;
    }

    const { state } = this.options;
    if (isPathInputScreen(state) && state.cursor === 0) {
      if (key === "ctrl+v" || key === "meta+v" || key === "cmd+v") {
        event.preventDefault();
        this.pasteFromClipboard();
        return;
      }
      const { effect, preventDefault } = handleCustomSourceTextInputKey(state, key);
      if (preventDefault) event.preventDefault();
      this.commit();
      this.options.onEffect(effect);
      return;
    }

    const effect = handleTuiKey(state, key);
    event.preventDefault();
    this.commit();
    this.options.onEffect(effect);
  };

  private readonly onPaste = (event: PasteEvent): void => {
    if (this.disposed) return;
    if (this.isTooSmall()) {
      event.preventDefault();
      return;
    }
    const { state } = this.options;
    if (!isPathInputScreen(state)) return;
    event.preventDefault();
    const text = new TextDecoder().decode(event.bytes);
    if (!appendTextInput(state, text)) {
      state.notice = "Clipboard is empty or contains unsupported text.";
    }
    this.commit();
  };

  /** Appends clipboard text to the path editor and re-renders. */
  pasteFromClipboard(): void {
    const { state } = this.options;
    const text = this.options.readClipboard?.() ?? "";
    if (!appendTextInput(state, text)) {
      state.notice = "Clipboard is empty or contains unsupported text.";
    }
    this.commit();
  }

  /** Click on a selectable row: move the cursor there, then confirm it. */
  private activateRow(index: number): void {
    const { state } = this.options;
    state.cursor = index;
    if (isPathInputScreen(state) && index === 0) {
      this.commit();
      return;
    }
    const effect = handleTuiKey(state, "enter");
    this.commit();
    this.options.onEffect(effect);
  }

  private commit(): void {
    this.options.onStateChanged?.();
    this.update();
  }

  private isTooSmall(): boolean {
    return this.renderer.width < MIN_COLUMNS || this.renderer.height < MIN_ROWS;
  }

  private syncInput(view: ScreenView): void {
    const input = view.input;
    this.inputHost.visible = input != null;
    if (input == null) {
      if (this.inputField.focused) this.inputField.blur();
      return;
    }

    this.inputField.placeholder = input.placeholder;
    if (this.inputField.value !== input.value) this.inputField.value = input.value;
    if (input.focused && !this.inputField.focused) this.inputField.focus();
    if (!input.focused && this.inputField.focused) this.inputField.blur();
  }

  private syncPanes(view: ScreenView): void {
    const split = view.panes.length > 1 && this.renderer.width >= SPLIT_COLUMNS;
    const panes = split ? [...view.panes].reverse() : view.panes;
    this.body.flexDirection = split ? "row" : "column";

    // Reuse pane boxes while the screen shape is stable so scroll offsets and
    // focus survive routine re-renders; rebuild whenever the shape changes.
    const signature = `${view.panes.map((p) => p.id).join("|")}:${split ? "row" : "column"}`;
    if (signature !== this.lastPaneSignature) {
      for (const child of this.body.getChildren().slice()) {
        this.body.remove(child);
        child.destroyRecursively();
      }
      this.paneScrolls = new Map();
      for (const paneView of panes) {
        this.body.add(this.createPane(paneView, split));
      }
      this.lastPaneSignature = signature;
    }

    for (const paneView of view.panes) {
      const scroll = this.paneScrolls.get(paneView.id);
      if (!scroll) continue;
      const box = scroll.parent;
      if (box instanceof BoxRenderable) box.title = ` ${paneView.title} `;
      this.fillPane(scroll, paneView);
    }
  }

  private createPane(paneView: ViewPane, split: boolean): BoxRenderable {
    const box = new BoxRenderable(this.renderer, {
      id: `ulis-pane-${paneView.id}`,
      flexGrow: paneView.grow,
      flexBasis: split ? 0 : undefined,
      width: split ? undefined : "100%",
      minHeight: 3,
      border: true,
      borderColor: THEME.border,
      title: ` ${paneView.title} `,
      titleColor: THEME.accent,
      flexDirection: "column",
    });

    const scroll = new ScrollBoxRenderable(this.renderer, {
      id: `ulis-scroll-${paneView.id}`,
      width: "100%",
      flexGrow: 1,
      scrollY: true,
      scrollX: false,
      focusable: true,
      contentOptions: { flexDirection: "column", paddingLeft: 1, paddingRight: 1 },
      scrollbarOptions: { visible: true },
    });

    box.add(scroll);
    this.paneScrolls.set(paneView.id, scroll);
    return box;
  }

  private fillPane(scroll: ScrollBoxRenderable, paneView: ViewPane): void {
    for (const child of scroll.getChildren().slice()) {
      scroll.remove(child);
      child.destroyRecursively();
    }
    paneView.rows.forEach((row, position) => {
      scroll.add(this.createRow(paneView.id, position, row));
    });
  }

  private createRow(paneId: string, position: number, row: ViewRow): Renderable {
    const id = `ulis-row-${paneId}-${position}`;

    switch (row.kind) {
      case "blank":
        return new TextRenderable(this.renderer, { id, content: " " });

      case "heading":
        return new TextRenderable(this.renderer, {
          id,
          content: row.text,
          fg: THEME.accent,
          attributes: 1,
          wrapMode: "word",
        });

      case "text":
        return new TextRenderable(this.renderer, {
          id,
          content: row.text,
          fg: toneColor(row.tone),
          marginLeft: row.indent ?? 0,
          wrapMode: "word",
        });

      case "field": {
        const box = new BoxRenderable(this.renderer, {
          id,
          width: "100%",
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 1,
        });
        box.add(
          new TextRenderable(this.renderer, {
            id: `${id}-label`,
            content: row.label,
            fg: THEME.text,
            flexShrink: 0,
            wrapMode: "none",
          }),
        );
        box.add(
          new TextRenderable(this.renderer, {
            id: `${id}-value`,
            content: row.value,
            fg: THEME.accent,
            flexShrink: 1,
            minWidth: 0,
            wrapMode: "none",
            truncate: true,
          }),
        );
        return box;
      }

      case "log": {
        const box = new BoxRenderable(this.renderer, { id, width: "100%", flexDirection: "row", gap: 1 });
        if (row.tag) {
          box.add(
            new TextRenderable(this.renderer, {
              id: `${id}-tag`,
              content: row.tag.text,
              fg: toneColor(row.tag.tone),
            }),
          );
        }
        box.add(
          new TextRenderable(this.renderer, {
            id: `${id}-text`,
            content: row.text,
            fg: THEME.text,
            flexGrow: 1,
            wrapMode: "word",
          }),
        );
        return box;
      }

      case "option":
        return this.createOptionRow(id, row);
    }
  }

  private createOptionRow(id: string, row: Extract<ViewRow, { kind: "option" }>): Renderable {
    const marker = row.selected ? ">" : " ";
    const checkbox = row.checked == null ? "" : `[${row.checked ? "x" : " "}] `;
    const color = row.selected ? THEME.accent : THEME.text;

    const container = new BoxRenderable(this.renderer, {
      id,
      width: "100%",
      flexDirection: "column",
      backgroundColor: row.selected ? THEME.selectionBg : "transparent",
      onMouseDown: (event: MouseEvent) => {
        event.stopPropagation();
        this.activateRow(row.index);
      },
    });

    const line = new BoxRenderable(this.renderer, {
      id: `${id}-line`,
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
    });
    line.add(
      new TextRenderable(this.renderer, {
        id: `${id}-label`,
        content: `${marker} ${checkbox}${row.label}`,
        fg: color,
        attributes: row.selected ? 1 : 0,
        flexShrink: 1,
        minWidth: 0,
        wrapMode: "none",
        truncate: true,
      }),
    );
    if (row.value != null) {
      line.add(
        new TextRenderable(this.renderer, {
          id: `${id}-value`,
          content: row.value,
          fg: row.selected ? THEME.accent : THEME.muted,
          flexShrink: 0,
          marginLeft: 1,
          wrapMode: "none",
        }),
      );
    }
    container.add(line);

    if (row.description) {
      container.add(
        new TextRenderable(this.renderer, {
          id: `${id}-desc`,
          content: row.description,
          fg: THEME.muted,
          marginLeft: 4,
          wrapMode: "word",
        }),
      );
    }

    return container;
  }
}

function isPathInputScreen(state: TuiState): boolean {
  return state.screen === "customSource" || state.screen === "customPresetSource";
}

/** Maps an OpenTUI key event onto the plain key strings `state.ts` understands. */
export function keyEventToKey(event: KeyEvent): string | undefined {
  const name = event.name;

  if (event.ctrl && name) return `ctrl+${name}`;
  if ((event.meta || event.super) && name) return `meta+${name}`;

  switch (name) {
    case "return":
    case "enter":
      return "enter";
    case "space":
      return "space";
    case "up":
    case "down":
    case "left":
    case "right":
    case "escape":
    case "backspace":
    case "delete":
    case "tab":
      return name;
    default:
      break;
  }

  if (name && name.length === 1) return name;
  if (event.sequence && event.sequence.length === 1) return event.sequence;
  return undefined;
}
