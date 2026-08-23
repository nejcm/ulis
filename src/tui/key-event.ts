/**
 * Translates OpenTUI's `KeyEvent` into the plain key strings `key-codes.ts` and the rest of the
 * key-dispatch state machine understand. The only OpenTUI-typed thing in this file - natural pair
 * with `key-codes.ts`, which takes it from here.
 */
import type { KeyEvent } from "@opentui/core";

/** Maps an OpenTUI key event onto the plain key strings `key-codes.ts` understands. */
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
    case "pagedown":
      return name;
    default:
      break;
  }

  if (name && name.length === 1) return name;
  if (event.sequence === "\x1b[6~") return "pagedown";
  if (event.sequence && event.sequence.length === 1) return event.sequence;
  return undefined;
}
