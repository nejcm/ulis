import type { Tone } from "./view.js";

/**
 * ULIS palette. Accents are fixed teal/cyan so the brand reads the same in every
 * terminal; everything else stays close to the terminal's own foreground tones.
 */
export const THEME = {
  accent: "#22d3ee",
  accentDim: "#0e7490",
  brand: "#14b8a6",
  text: "#d4d4d4",
  muted: "#8a8a8a",
  success: "#4ade80",
  warn: "#fbbf24",
  error: "#f87171",
  border: "#3f4b52",
  borderFocused: "#22d3ee",
  selectionBg: "#0b3b45",
} as const;

export function toneColor(tone: Tone | undefined): string {
  switch (tone) {
    case "accent":
      return THEME.accent;
    case "muted":
      return THEME.muted;
    case "success":
      return THEME.success;
    case "warn":
      return THEME.warn;
    case "error":
      return THEME.error;
    default:
      return THEME.text;
  }
}
