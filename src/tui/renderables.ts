/**
 * Turns `ViewPane`/`ViewRow` plus `THEME` into OpenTUI renderables. Exported surface is
 * `createPane` (builds a scroll region), `fillPane` (populates it row by row) and `rowId`
 * (the id scheme both share, needed by callers to address rows by position); `createRow` and
 * `createOptionRow` are internal helpers `fillPane` uses and stay module-local. No app state -
 * callers own the pane/scroll bookkeeping (`app.ts` keeps its own `paneScrolls` map) and pass an
 * `onActivateRow` callback for the one place a row needs to reach back into app state (a mouse
 * click on an option row).
 */
import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
  type MouseEvent,
  type Renderable,
} from "@opentui/core";

import { THEME, toneColor } from "./theme.js";
import { displayWidth, MIN_ROWS, type ViewPane, type ViewRow } from "./view/index.js";

const MINIMUM_REVIEW_ACTION_HEIGHT = 6;

export interface PaneRenderable {
  readonly box: BoxRenderable;
  readonly scroll: ScrollBoxRenderable;
}

function estimatedPaneLines(renderer: CliRenderer, paneView: ViewPane): number {
  const contentWidth = Math.max(1, renderer.width - 5);
  return paneView.rows.reduce((lines, row) => {
    if (row.kind !== "text") return lines + 1;
    return (
      lines +
      row.text
        .split("\n")
        .reduce((wrapped, line) => wrapped + Math.max(1, Math.ceil(displayWidth(line) / contentWidth)), 0)
    );
  }, 0);
}

export function createPane(
  renderer: CliRenderer,
  paneView: ViewPane,
  split: boolean,
  compact: boolean,
): PaneRenderable {
  const actionHeight =
    compact && paneView.grow === 0
      ? Math.min(estimatedPaneLines(renderer, paneView) + 2, renderer.height - MIN_ROWS + MINIMUM_REVIEW_ACTION_HEIGHT)
      : undefined;
  const box = new BoxRenderable(renderer, {
    id: `ulis-pane-${paneView.id}`,
    flexGrow: paneView.grow,
    height: actionHeight,
    flexShrink: actionHeight == null ? undefined : 0,
    flexBasis: split ? 0 : undefined,
    width: split ? undefined : "100%",
    minHeight: actionHeight == null ? 3 : Math.min(4, actionHeight),
    border: true,
    borderColor: THEME.border,
    title: ` ${paneView.title} `,
    titleColor: THEME.accent,
    flexDirection: "column",
  });

  const scroll = new ScrollBoxRenderable(renderer, {
    id: `ulis-scroll-${paneView.id}`,
    width: "100%",
    flexGrow: 1,
    scrollY: true,
    scrollX: false,
    focusable: true,
    contentOptions: { flexDirection: "column", padding: compact ? 0 : 1 },
    scrollbarOptions: { visible: true },
  });

  box.add(scroll);
  return { box, scroll };
}

export function fillPane(
  renderer: CliRenderer,
  scroll: ScrollBoxRenderable,
  paneView: ViewPane,
  onActivateRow: (index: number) => void,
): void {
  for (const child of scroll.getChildren().slice()) {
    scroll.remove(child);
    child.destroyRecursively();
  }
  paneView.rows.forEach((row, position) => {
    scroll.add(createRow(renderer, paneView.id, position, row, onActivateRow));
  });
}

export function rowId(paneId: string, position: number): string {
  return `ulis-row-${paneId}-${position}`;
}

function createRow(
  renderer: CliRenderer,
  paneId: string,
  position: number,
  row: ViewRow,
  onActivateRow: (index: number) => void,
): Renderable {
  const id = rowId(paneId, position);

  switch (row.kind) {
    case "blank":
      return new TextRenderable(renderer, { id, content: " " });

    case "heading":
      return new TextRenderable(renderer, {
        id,
        content: row.text,
        fg: THEME.accent,
        attributes: 1,
        wrapMode: "word",
      });

    case "text":
      return new TextRenderable(renderer, {
        id,
        content: row.text,
        fg: toneColor(row.tone),
        marginLeft: row.indent ?? 0,
        wrapMode: "word",
      });

    case "field": {
      const box = new BoxRenderable(renderer, {
        id,
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 1,
      });
      box.add(
        new TextRenderable(renderer, {
          id: `${id}-label`,
          content: row.label,
          fg: THEME.text,
          flexShrink: 0,
          wrapMode: "none",
        }),
      );
      box.add(
        new TextRenderable(renderer, {
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
      const box = new BoxRenderable(renderer, { id, width: "100%", flexDirection: "row", gap: 1 });
      if (row.tag) {
        box.add(
          new TextRenderable(renderer, {
            id: `${id}-tag`,
            content: row.tag.text,
            fg: toneColor(row.tag.tone),
          }),
        );
      }
      box.add(
        new TextRenderable(renderer, {
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
      return createOptionRow(renderer, id, row, onActivateRow);
  }
}

function createOptionRow(
  renderer: CliRenderer,
  id: string,
  row: Extract<ViewRow, { kind: "option" }>,
  onActivateRow: (index: number) => void,
): Renderable {
  const marker = row.selected ? ">" : " ";
  const checkbox = row.checked == null ? "" : `[${row.checked ? "x" : " "}] `;
  const color = row.selected ? THEME.accent : THEME.text;

  const container = new BoxRenderable(renderer, {
    id,
    width: "100%",
    flexDirection: "column",
    backgroundColor: row.selected ? THEME.selectionBg : "transparent",
    onMouseDown: (event: MouseEvent) => {
      event.stopPropagation();
      onActivateRow(row.index);
    },
  });

  const line = new BoxRenderable(renderer, {
    id: `${id}-line`,
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
  });
  line.add(
    new TextRenderable(renderer, {
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
      new TextRenderable(renderer, {
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
      new TextRenderable(renderer, {
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
