import { beforeEach, describe, expect, it, mock } from "bun:test";

const celRender = mock(() => {});

const runTuiActionMock = mock((..._args: unknown[]) => {});
const initializeMissingSourceMock = mock(async () => {});
const readClipboardTextMock = mock(() => "");

mock.module("@cel-tui/core", () => ({
  ProcessTerminal: class ProcessTerminal {},
  VStack: (...args: unknown[]) => args,
  HStack: (...args: unknown[]) => args,
  Text: (...args: unknown[]) => args,
  TextInput: (...args: unknown[]) => args,
  cel: {
    init: mock(() => {}),
    viewport: mock(() => {}),
    render: celRender,
    stop: mock(() => {}),
  },
}));

mock.module("./tui/actions.js", () => ({
  runTuiAction: runTuiActionMock,
  initializeMissingSource: initializeMissingSourceMock,
  __test: {
    setRuntimeDependencies: () => undefined,
    resetRuntimeDependencies: () => undefined,
  },
}));

mock.module("./tui/clipboard.js", () => ({
  readClipboardText: readClipboardTextMock,
}));

const { __test } = await import("./tui.js");

describe("tui effect flow", () => {
  beforeEach(() => {
    __test.resetState();
    celRender.mockClear();
    runTuiActionMock.mockReset();
    initializeMissingSourceMock.mockReset();
    readClipboardTextMock.mockReset();
  });

  it("handles start effect success and lands on result screen", async () => {
    runTuiActionMock.mockImplementation(() => {});

    await __test.handleEffect({ type: "start", action: "build" });

    const state = __test.getState();
    expect(state.screen).toBe("result");
    expect(state.resultTitle).toBe("Build Complete");
    expect(state.resultMessage).toContain("completed successfully");
  });

  it("formats preset install start effects", async () => {
    runTuiActionMock.mockImplementation(() => {});

    await __test.handleEffect({ type: "start", action: "presetInstall" });

    const state = __test.getState();
    expect(state.screen).toBe("result");
    expect(state.resultTitle).toBe("Preset Install Complete");
  });

  it("handles async start effect failure and records error", async () => {
    runTuiActionMock.mockImplementation(async () => {
      throw new Error("kaboom");
    });

    await __test.handleEffect({ type: "start", action: "validate" });

    const state = __test.getState();
    expect(state.screen).toBe("result");
    expect(state.resultTitle).toBe("Validate Failed");
    expect(state.resultMessage).toBe("kaboom");
    expect(state.logs.some((line: string) => line.includes("[error] kaboom"))).toBe(true);
  });

  it("stops a running action when cancelRunning is handled", async () => {
    let capturedSignal: AbortSignal | undefined;
    runTuiActionMock.mockImplementation((...args: unknown[]) => {
      const options = args[3] as { signal: AbortSignal };
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const run = __test.handleEffect({ type: "start", action: "install" });
    await Promise.resolve();
    await __test.handleEffect({ type: "cancelRunning" });
    await run;

    const state = __test.getState();
    expect(capturedSignal?.aborted).toBe(true);
    expect(state.screen).toBe("result");
    expect(state.resultTitle).toBe("Install Stopped");
  });

  it("handles initSource effect, clears pendingAction, and resumes the pending action", async () => {
    const state = __test.getState();
    state.pendingAction = "build";

    await __test.handleEffect({ type: "initSource" });

    expect(initializeMissingSourceMock).toHaveBeenCalledTimes(1);
    expect(runTuiActionMock).toHaveBeenCalledTimes(1);
    const call = runTuiActionMock.mock.calls[0] as unknown[] | undefined;
    expect(call?.[1]).toBe("build");
    expect(state.pendingAction).toBeUndefined();
    expect(state.screen).toBe("result");
    expect(state.resultTitle).toBe("Initialize source and Build Complete");
  });

  it("handles clipboard paste effect in custom source input", async () => {
    readClipboardTextMock.mockImplementation(() => "C:\\Work\\Personal\\ulis\\.ulis");
    const state = __test.getState();
    state.screen = "customSource";

    await __test.handleEffect({ type: "pasteClipboard" });

    expect(state.textInput).toBe("C:\\Work\\Personal\\ulis\\.ulis");
    expect(celRender).toHaveBeenCalled();
  });

  it("shows a notice when clipboard paste has no usable text", async () => {
    readClipboardTextMock.mockImplementation(() => "");
    const state = __test.getState();
    state.screen = "customSource";

    await __test.handleEffect({ type: "pasteClipboard" });

    expect(state.notice).toContain("Clipboard");
  });
});
