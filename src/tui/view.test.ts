import { describe, expect, it } from "bun:test";

import { createInitialState } from "./state.js";
import { buildScreenView, MIN_COLUMNS, MIN_ROWS, SPLIT_COLUMNS, splitLogTag } from "./view.js";

describe("splitLogTag", () => {
  it("separates colored status tags from unstyled message text", () => {
    expect(splitLogTag("[info] Installing * skill: microsoft/playwright-cli")).toEqual({
      text: "Installing * skill: microsoft/playwright-cli",
      tag: { text: "[info]", tone: "accent" },
    });
    expect(splitLogTag("[done] * skill: microsoft/playwright-cli")).toEqual({
      text: "* skill: microsoft/playwright-cli",
      tag: { text: "[done]", tone: "success" },
    });
    expect(splitLogTag("[warn] Failed to install * skill: bad/repo")).toEqual({
      text: "Failed to install * skill: bad/repo",
      tag: { text: "[warn]", tone: "warn" },
    });
    expect(splitLogTag("[error] install failed")).toEqual({
      text: "install failed",
      tag: { text: "[error]", tone: "error" },
    });
  });

  it("keeps untagged log lines unstyled", () => {
    expect(splitLogTag("=== Installing External Skills ===")).toEqual({ text: "=== Installing External Skills ===" });
  });

  it("separates the status tag from multiline diagnostics", () => {
    expect(splitLogTag("[error] Invalid config\n  path: .ulis/ulis.yaml")).toEqual({
      text: "Invalid config\n  path: .ulis/ulis.yaml",
      tag: { text: "[error]", tone: "error" },
    });
  });
});

describe("layout thresholds", () => {
  it("keeps the responsive breakpoints ordered", () => {
    expect(MIN_COLUMNS).toBeLessThan(SPLIT_COLUMNS);
    expect(MIN_ROWS).toBeGreaterThan(0);
  });
});

describe("buildScreenView", () => {
  it("describes the start screen with selectable options", () => {
    const state = createInitialState();
    const view = buildScreenView(state);

    expect(view.panes).toHaveLength(1);
    const options = view.panes[0]!.rows.filter((row) => row.kind === "option");
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toMatchObject({ index: 0, selected: true });
    expect(view.controls.join(" ")).toContain("quit");
  });

  it("splits the plan screen into summary and action panes", () => {
    const state = createInitialState();
    state.screen = "plan";
    const view = buildScreenView(state);

    expect(view.panes.length).toBeGreaterThan(1);
    expect(view.panes.map((pane) => pane.title)).toContain("Actions");
  });

  it("exposes the editable path input on the custom source screen", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.cursor = 0;
    state.textInput = "./configs";

    const view = buildScreenView(state);
    expect(view.input).toMatchObject({ value: "./configs", focused: true });
  });

  it("exposes the custom preset directory input", () => {
    const state = createInitialState();
    state.screen = "customPresetSource";
    state.textInput = "./presets";

    const view = buildScreenView(state);

    expect(view.title).toBe("Custom preset directory");
    expect(view.input).toMatchObject({ value: "./presets", focused: true });
    expect(view.panes).toEqual([]);
  });

  it("shows the custom preset path and extension warning in the install review", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = "C:\\presets";
    state.presetInstallExtensions = true;

    const rows = buildScreenView(state).panes.flatMap((pane) => pane.rows);

    expect(rows).toContainEqual(expect.objectContaining({ label: "Preset location", value: "Custom C:\\presets" }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: "text", text: expect.stringContaining("npx") }));
  });

  it("renders running logs with their status tags", () => {
    const state = createInitialState();
    state.screen = "running";
    state.logs = ["=== Build ===", "[warn] slow"];

    const view = buildScreenView(state);
    const logs = view.panes.flatMap((pane) => pane.rows).filter((row) => row.kind === "log");
    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatchObject({ tag: { text: "[warn]", tone: "warn" } });
  });

  it("marks a failed result with the error tone", () => {
    const state = createInitialState();
    state.screen = "result";
    state.resultTitle = "Build Failed";
    state.resultMessage = "boom";

    const view = buildScreenView(state);
    expect(view.title).toContain("Build Failed");
  });
});
