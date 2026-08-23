/** Raw key-event normalization and classification, shared by the key-dispatch state machine. */

export type NavigationDirection = "up" | "down";

const KEY_DUPLICATE_WINDOW_MS = 35;
let lastKeyEvent: { readonly id: string; readonly at: number } | undefined;

/** Clears duplicate-key tracking for a fresh session; called from `createInitialState` in state-model.ts. */
export function resetDuplicateKeyTracking(): void {
  lastKeyEvent = undefined;
}

export function isAnyKey(key: string, ...candidates: readonly string[]): boolean {
  return candidates.includes(key);
}

export function isConfirmKey(key: string): boolean {
  return isAnyKey(key, "enter");
}

export function isToggleKey(key: string): boolean {
  return isConfirmKey(key) || isAnyKey(key, "x", " ", "space");
}

export function isPasteKey(key: string): boolean {
  return isAnyKey(key, "ctrl+v", "cmd+v", "command+v", "meta+v");
}

function isUpKey(key: string): boolean {
  return isAnyKey(key, "k", "up", "arrowup");
}

function isDownKey(key: string): boolean {
  return isAnyKey(key, "j", "down", "arrowdown");
}

export function getNavigationDirection(key: string): NavigationDirection | undefined {
  if (isUpKey(key)) return "up";
  if (isDownKey(key)) return "down";
  return undefined;
}

export function isDuplicateKeyEvent(key: string): boolean {
  const id = keyEventId(key);
  const now = Date.now();
  const duplicate = lastKeyEvent != null && lastKeyEvent.id === id && now - lastKeyEvent.at <= KEY_DUPLICATE_WINDOW_MS;
  lastKeyEvent = { id, at: now };
  return duplicate;
}

function keyEventId(key: string): string {
  const direction = getNavigationDirection(key);
  if (direction) return `nav:${direction}`;
  if (isConfirmKey(key)) return "confirm";
  if (isPasteKey(key)) return "paste";
  if (isAnyKey(key, " ", "space")) return "space";
  return key;
}

export function textInputValue(key: string): string | undefined {
  const text = key.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "");
  if (text.length === 0 || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  return text;
}

export function normalizeKey(rawKey: string): string {
  if (rawKey.length === 0) return rawKey;

  if (rawKey === "\u0003") return "ctrl+c";
  if (rawKey === "\u0016") return "ctrl+v";
  if (isAnyKey(rawKey, "\r", "\n")) return "enter";
  if (isAnyKey(rawKey, "\u007f", "\u0008")) return "backspace";
  if (rawKey === "\u001b[3~") return "delete";
  if (isAnyKey(rawKey, "\u001b[A", "\u001bOA")) return "up";
  if (isAnyKey(rawKey, "\u001b[B", "\u001bOB")) return "down";

  const lowered = rawKey.toLowerCase();
  if (isAnyKey(lowered, "return", "newline")) return "enter";
  if (isAnyKey(lowered, "spacebar")) return "space";
  if (isAnyKey(lowered, "arrowup")) return "up";
  if (isAnyKey(lowered, "arrowdown")) return "down";
  if (isAnyKey(lowered, "del")) return "delete";
  if (isAnyKey(lowered, "esc")) return "escape";

  return lowered.startsWith("ctrl+") ||
    lowered.startsWith("cmd+") ||
    lowered.startsWith("command+") ||
    lowered.startsWith("meta+")
    ? lowered
    : rawKey;
}

/** Advances `state.cursor` by one row in the given direction, wrapping at `[0, lastIndex]`. */
export function moveCursor(state: { cursor: number }, key: string, lastIndex: number): void {
  const direction = getNavigationDirection(key);
  if (!direction) return;

  if (direction === "up") {
    state.cursor = (state.cursor + lastIndex) % (lastIndex + 1);
  } else {
    state.cursor = (state.cursor + 1) % (lastIndex + 1);
  }
}
