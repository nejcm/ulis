import { describe, expect, it } from "bun:test";

import { planItems } from "./selectors.js";
import {
  createInitialState,
  PRESET_INSTALL_REVIEW_BACK_ROW,
  PRESET_INSTALL_REVIEW_START_ROW,
  type PlanItemId,
} from "./state-model.js";
import { buildScreenView, MIN_COLUMNS, MIN_ROWS, SPLIT_COLUMNS, splitLogTag } from "./view/index.js";

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

  it("renders a blank row directly after every plan item marked breakAfter, for every flow", () => {
    // Ids that end a visual section of the plan screen. Identity-based (compiler-checked via
    // PlanItemId), unlike the old positional BREAKS index arrays this replaces -- reordering or
    // inserting rows can't silently desync this from the render. Shared across both flows: both
    // item arrays currently break after the same three sections.
    const expectedBreakAfterIds = new Set<PlanItemId>(["destination", "backup", "install"]);

    for (const flow of ["project", "presetsOnly"] as const) {
      const state = createInitialState();
      state.screen = "plan";
      state.flow = flow;

      const view = buildScreenView(state);
      const actionsPane = view.panes.find((pane) => pane.title === "Actions");
      expect(actionsPane).toBeDefined();

      // Walk items and rendered rows together: each item consumes one "option" row, plus a
      // trailing "blank" row exactly when its id is expected to end a section. This asserts
      // adjacency (blank directly follows its item), not fixed row numbers.
      const items = planItems(state);
      let rowIndex = 0;
      for (const item of items) {
        expect(actionsPane!.rows[rowIndex]).toMatchObject({ kind: "option", label: item.label });
        rowIndex += 1;
        if (expectedBreakAfterIds.has(item.id)) {
          expect(actionsPane!.rows[rowIndex]).toEqual({ kind: "blank" });
          rowIndex += 1;
        }
      }
      expect(rowIndex).toBe(actionsPane!.rows.length);
    }
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

describe("preset install review rows", () => {
  it("renders the option rows the cursor constants name", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";

    const options = buildScreenView(state)
      .panes.flatMap((pane) => pane.rows)
      .filter((row): row is Extract<typeof row, { kind: "option" }> => row.kind === "option");

    // The key handler and the controller both aim the cursor with these constants; if the render
    // ever moves a row, the constants must move with it rather than silently pointing at a toggle.
    expect(options.find((row) => row.index === PRESET_INSTALL_REVIEW_START_ROW)?.label).toBe("Start preset install");
    expect(options.find((row) => row.index === PRESET_INSTALL_REVIEW_BACK_ROW)?.label).toBe("Back to presets");
    expect(Math.max(...options.map((row) => row.index))).toBe(PRESET_INSTALL_REVIEW_BACK_ROW);
  });
});

describe("review controls", () => {
  it("shows confirm-only controls on the install review", () => {
    const state = createInitialState();
    state.screen = "installReview";

    expect(buildScreenView(state).controls).toContain("Enter: select");
    expect(buildScreenView(state).controls).toContain("PgDn: review commands");
    expect(buildScreenView(state).controls.join(" ")).not.toMatch(/x\/space|Enter\/x\/space/u);
  });

  it("distinguishes preset review confirmation from toggling", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";

    expect(buildScreenView(state).controls).toContain("Enter: select");
    expect(buildScreenView(state).controls).toContain("x/space: toggle");
  });
});

describe("remote command consent", () => {
  function rowText(state: ReturnType<typeof createInitialState>): string {
    return buildScreenView(state)
      .panes.flatMap((pane) => pane.rows)
      .map((row) => ("text" in row ? row.text : "label" in row ? `${row.label} ${row.value ?? ""}` : ""))
      .join("\n");
  }

  it("lists the commands a remote source will run, with provenance", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.remoteCommandSource = "https://github.com/o/r";
    state.remoteCommands = ["npx skills@latest add acme/skill", "npx some-extension --flag"];

    const text = rowText(state);

    expect(text).toContain("REMOTE: 2 entries WILL apply");
    expect(text).toContain("@ github.com/o/r");
    // Framed by when an entry executes, not by what kind of entry it is: the planner adds classes
    // (config files a host agent runs later, an approval setting that widens what it may run
    // without asking, not only commands) and the wording must stay true - "WILL RUN" would be false
    // for an approval-setting entry, which never runs anything itself.
    // The fixed action row carries count, provenance, and urgency while the command pane scrolls.
    expect(text).toContain("WILL apply");
    expect(text).toContain("run later inside your agent");
    expect(text).toContain("npx skills@latest add acme/skill");
    expect(text).toContain("npx some-extension --flag");
  });

  it("shows the same section on the preset install review screen", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.remoteCommandSource = "https://github.com/o/r";
    state.remoteCommands = ["npx some-extension"];

    expect(rowText(state)).toContain("npx some-extension");
  });

  it("gates a remote source whose recognised plan is empty", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.remoteCommandSource = "https://github.com/o/r";
    state.remoteCommands = [];

    const text = rowText(state);

    // An empty plan is not "nothing happens", and the CLI refuses to skip its gate there
    // (`confirmRemoteCommands`). This screen must say the same thing, in the same words.
    expect(text).toContain("REMOTE:");
    expect(text).toContain("WILL be installed");
    expect(text).toContain("@ github.com/o/r");
    expect(text).toContain("Nothing here was recognised as executable - which is not a guarantee.");
    expect(text).toContain("Its files will still be installed for:");
  });

  it("shows the empty-plan gate on the preset install review screen too", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.remoteCommandSource = "https://github.com/o/r";
    state.remoteCommands = [];

    expect(rowText(state)).toContain("Nothing here was recognised as executable - which is not a guarantee.");
  });

  it("shows no remote gate when the install is purely local", () => {
    const state = createInitialState();
    state.screen = "installReview";

    const text = rowText(state);

    expect(text).not.toContain("REMOTE:");
    expect(text).not.toContain("Nothing here was recognised");
    expect(text).not.toContain("run later inside your agent");
  });

  it("redacts credentials in the source picker and recents list", () => {
    const state = createInitialState();
    state.screen = "source";
    state.customSource = "https://user:s3cret@github.com/o/r";
    expect(rowText(state)).not.toContain("s3cret");

    state.screen = "customSource";
    state.recentCustomSources = ["https://user:s3cret@github.com/o/r"];
    expect(rowText(state)).not.toContain("s3cret");
  });
});
