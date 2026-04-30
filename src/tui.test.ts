import { beforeEach, describe, expect, it, mock } from "bun:test";

const celRender = mock(() => {});

const runTuiActionMock = mock(() => {});
const initializeMissingSourceMock = mock(async () => {});

mock.module("@cel-tui/core", () => ({
  ProcessTerminal: class ProcessTerminal {},
  VStack: (...args: unknown[]) => args,
  HStack: (...args: unknown[]) => args,
  Text: (...args: unknown[]) => args,
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

const { __test } = await import("./tui.js");

describe("tui effect flow", () => {
  beforeEach(() => {
    __test.resetState();
    celRender.mockClear();
    runTuiActionMock.mockReset();
    initializeMissingSourceMock.mockReset();
  });

  it("handles start effect success and lands on result screen", async () => {
    runTuiActionMock.mockImplementation(() => {});

    await __test.handleEffect({ type: "start", action: "build" });

    const state = __test.getState();
    expect(state.screen).toBe("result");
    expect(state.resultTitle).toBe("Build Complete");
    expect(state.resultMessage).toContain("completed successfully");
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
});
