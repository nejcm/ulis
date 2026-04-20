export async function tuiCmd(): Promise<void> {
  // The TUI is heavy (pulls in @cel-tui/core); load lazily so the CLI
  // start-up stays fast for the common non-tui commands.
  const mod = await import("../tui.js");
  if (typeof mod.runTui === "function") {
    mod.runTui();
  }
}
