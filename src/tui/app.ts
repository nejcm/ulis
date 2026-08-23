import {
  BoxRenderable,
  CliRenderEvents,
  InputRenderable,
  InputRenderableEvents,
  type CliRenderer,
  type KeyEvent,
  type PasteEvent,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";

import { ConsentGate, type ConsentRow, type ConsentScrollRegion } from "./consent-gate.js";
import { keyEventToKey } from "./key-event.js";
import {
  appendTextInput,
  applyCustomSourceTextInputChange,
  handleCustomSourceTextInputKey,
  handleTuiKey,
} from "./keys.js";
import { createPane, fillPane, rowId } from "./renderables.js";
import { type TuiEffect, type TuiState } from "./state-model.js";
import { THEME, toneColor } from "./theme.js";
import { buildScreenView, MIN_COLUMNS, MIN_ROWS, SPLIT_COLUMNS, type ScreenView, type ViewPane } from "./view/index.js";

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
  /** Overrides the home directory used in rendered plan paths. */
  readonly userHome?: string;
}

/** Wraps a live scroll region as the narrow geometry interface `ConsentGate` reads and nudges. */
function consentScrollRegion(scroll: ScrollBoxRenderable): ConsentScrollRegion {
  return {
    get viewportTop() {
      return scroll.viewport.screenY;
    },
    get viewportHeight() {
      return scroll.viewport.height;
    },
    get scrollTop() {
      return scroll.scrollTop;
    },
    set scrollTop(value: number) {
      scroll.scrollTop = value;
    },
    extentOf(id: string) {
      const target = scroll.getRenderable(id);
      return target ? { top: target.screenY, height: target.height } : undefined;
    },
  };
}

/**
 * Imperative OpenTUI shell for the ULIS TUI.
 *
 * The app owns only presentation and input routing; every state transition goes
 * through the shared handlers in `keys.ts`, so keyboard and mouse cannot drift
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

  private readonly consentGate = new ConsentGate();
  private paneScrolls = new Map<string, ScrollBoxRenderable>();
  private selectedRow?: ConsentRow;
  private lastPaneSignature = "";
  private disposed = false;
  private frozen = false;

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

    renderer.on(CliRenderEvents.FRAME, this.onFrame);
    this.attachInputHandlers();
    this.update();
  }

  /**
   * Stops every repaint from here on. Shutdown tears the renderer down, and `update` is reached
   * from key, input and commit paths that do not go through the controller, so `disposed` alone
   * would leave a window where those still paint into a renderer that is being destroyed.
   */
  freeze(): void {
    this.frozen = true;
  }

  /** Rebuilds the visible frame from the current state. */
  update(): void {
    if (this.disposed || this.frozen) return;

    const tooSmall = this.renderer.width < MIN_COLUMNS || this.renderer.height < MIN_ROWS;
    this.root.visible = !tooSmall;
    this.resizeHint.visible = tooSmall;
    if (tooSmall) {
      this.renderer.requestRender();
      return;
    }

    const view = buildScreenView(this.options.state, this.options.cwd, this.options.userHome, this.renderer.width);

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
    this.renderer.off(CliRenderEvents.FRAME, this.onFrame);
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

  private readonly onFrame = (): void => {
    if (this.disposed) return;
    this.consentGate.notePainted();
    this.consentGate.markVisibleConsentRows();
  };

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
      const { effect, preventDefault } = handleCustomSourceTextInputKey(state, key, this.options.cwd);
      if (preventDefault) event.preventDefault();
      this.commit();
      this.options.onEffect(effect);
      return;
    }

    if (key === "pagedown" && this.consentGate.hasRemoteReviewConsent(state)) {
      event.preventDefault();
      this.update();
      this.consentGate.scrollToFirstUnseenConsentRow();
      this.renderer.requestRender();
      return;
    }

    if (key === "enter" && this.consentGate.isReviewStart(state)) {
      this.update();
      if (!this.consentGate.reviewStartCanProceed(this.selectedRow)) {
        event.preventDefault();
        this.blockReviewStart();
        return;
      }
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
    if (this.consentGate.isReviewStart(state)) {
      this.update();
      if (!this.consentGate.reviewStartCanProceed(this.selectedRow)) {
        this.blockReviewStart();
        return;
      }
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

  private blockReviewStart(): void {
    const shouldScroll = this.consentGate.blockReviewStart(this.options.state);
    this.update();
    if (shouldScroll) this.consentGate.scrollToFirstUnseenConsentRow();
    this.renderer.requestRender();
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
    this.consentGate.syncSignature(this.renderer.width, this.options.state);

    const compact = view.panes.some((pane) => pane.grow === 0);
    const split = !compact && view.panes.length > 1 && this.renderer.width >= SPLIT_COLUMNS;
    const panes = split ? [...view.panes].reverse() : view.panes;
    this.body.flexDirection = split ? "row" : "column";
    this.body.paddingTop = compact ? 0 : 1;
    this.body.gap = compact ? 0 : 1;

    // Reuse pane boxes while the screen shape is stable so scroll offsets and
    // focus survive routine re-renders; rebuild whenever the shape changes.
    const signature = `${view.panes.map((p) => p.id).join("|")}:${split ? "row" : "column"}:${compact}`;
    if (signature !== this.lastPaneSignature) {
      for (const child of this.body.getChildren().slice()) {
        this.body.remove(child);
        child.destroyRecursively();
      }
      this.paneScrolls = new Map();
      for (const paneView of panes) {
        this.body.add(this.mountPane(paneView, split, compact));
      }
      this.lastPaneSignature = signature;
    }

    let selected: ConsentRow | undefined;
    let selectedScroll: ScrollBoxRenderable | undefined;
    const commandRows: ConsentRow[] = [];
    const warningRows: ConsentRow[] = [];
    for (const paneView of view.panes) {
      const scroll = this.paneScrolls.get(paneView.id);
      if (!scroll) continue;
      const box = scroll.parent;
      if (box instanceof BoxRenderable) box.title = ` ${paneView.title} `;
      fillPane(this.renderer, scroll, paneView, (index) => this.activateRow(index));
      const region = consentScrollRegion(scroll);
      paneView.rows.forEach((row, position) => {
        if (row.kind !== "text" || row.consent == null) return;
        const target = row.consent === "command" ? commandRows : warningRows;
        target.push([region, rowId(paneView.id, position)]);
      });
      const position = paneView.rows.findIndex((row) => row.kind === "option" && row.selected);
      if (position >= 0) {
        const id = rowId(paneView.id, position);
        selected = [region, id];
        selectedScroll = scroll;
      }
    }
    this.consentGate.setRows(commandRows, warningRows);
    this.selectedRow = selected;
    if (selected && selectedScroll) {
      this.renderer.root.calculateLayout();
      this.renderer.root.updateLayout(0);
      selectedScroll.scrollChildIntoView(selected[1]);
    }
  }

  private mountPane(paneView: ViewPane, split: boolean, compact: boolean): BoxRenderable {
    const { box, scroll } = createPane(this.renderer, paneView, split, compact);
    this.paneScrolls.set(paneView.id, scroll);
    return box;
  }
}

function isPathInputScreen(state: TuiState): boolean {
  return state.screen === "customSource" || state.screen === "customPresetSource";
}
