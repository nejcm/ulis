import { describe, expect, it, spyOn } from "bun:test";

import { formatLogMessage, logger } from "./logger.js";

const ANSI_REGEX = /\x1B\[[0-9;]*m/g;

describe("formatLogMessage", () => {
  it("colors install stages and skill identities", () => {
    const message = formatLogMessage("info", "Installing * skill: microsoft/playwright-cli", true);

    expect(message).toContain("\x1b[");
    expect(message.replace(ANSI_REGEX, "")).toBe("Installing * skill: microsoft/playwright-cli");
  });

  it("colors completed and failed install items by outcome", () => {
    const success = formatLogMessage("success", "codex skill: microsoft/playwright-cli", true);
    const failure = formatLogMessage("warn", "Failed to install codex skill: microsoft/playwright-cli (exit 1)", true);

    expect(success).toContain("\x1b[32m");
    expect(failure).toContain("\x1b[31m");
    expect(failure.replace(ANSI_REGEX, "")).toBe("Failed to install codex skill: microsoft/playwright-cli (exit 1)");
  });

  it("returns plain text when color is disabled", () => {
    expect(formatLogMessage("info", "Installing External Skills", false)).toBe("Installing External Skills");
  });

  it("uses stderr color support and tags every physical error line", () => {
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const stderrDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    const noColor = process.env.NO_COLOR;
    const forceColor = process.env.FORCE_COLOR;
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      delete process.env.NO_COLOR;
      delete process.env.FORCE_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });

      logger.error("Invalid config\n  path: .ulis/ulis.yaml");

      expect(errorSpy).toHaveBeenCalledWith("[error] Invalid config\n[error]   path: .ulis/ulis.yaml");
    } finally {
      errorSpy.mockRestore();
      if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
      if (stderrDescriptor) Object.defineProperty(process.stderr, "isTTY", stderrDescriptor);
      else delete (process.stderr as { isTTY?: boolean }).isTTY;
      if (noColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = noColor;
      if (forceColor === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = forceColor;
    }
  });
});
