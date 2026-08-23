// selectors.ts: source/destination planning (planSource), remote-vs-local classification, custom
// preset refs, and credential redaction across the display, recent-source, and preference-snapshot
// paths. Also covers planItems id-uniqueness, and touches keys.ts/preferences.ts where a test needs
// to drive state through a real key handler or round-trip it through the preferences snapshot.
import { afterEach, describe, expect, it } from "bun:test";

import { cleanupTempRoots } from "../test-utils/fs.js";
import { handleCustomSourceTextInputKey, handleTuiKey } from "./keys.js";
import { snapshotTuiPreferences } from "./preferences.js";
import {
  formatSourceMode,
  normalizeCustomSourceInput,
  planItems,
  planSource,
  remotePresetRef,
  rememberCustomSource,
} from "./selectors.js";
import { createInitialState } from "./state-model.js";

// No test here creates a temp root today, but this file's tests were covered by keys.test.ts's
// root afterEach at baseline (before the split) - kept as a literal no-op hook so a temp root
// added later here is not silently leaked. See test-support.ts for why this must stay literal
// per file rather than centralised.
afterEach(cleanupTempRoots);

describe("remote sources", () => {
  const url = "https://github.com/o/r";

  it("keeps a remote custom source as a URL rather than resolving it as a path", () => {
    expect(normalizeCustomSourceInput(url, "/project")).toBe(url);
  });

  it("plans a remote source without touching the filesystem", () => {
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = url;

    // `sourceExists` must be true without cloning, or the TUI diverts to the missingSource screen.
    expect(planSource(state, "/project", "/home/u")).toMatchObject({
      sourceDir: url,
      destBase: "/project",
      remote: true,
      sourceExists: true,
    });
  });

  it("installs a remote source to home when the destination is global", () => {
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = url;
    state.destinationMode = "global";

    expect(planSource(state, "/project", "/home/u")).toMatchObject({ destBase: "/home/u", remote: true });
  });

  it("marks a local custom source as not remote", () => {
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = "./example";

    expect(planSource(state, "/project", "/home/u").remote).toBe(false);
  });

  it("treats a remote preset location as a ref, not a directory to scan", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.screen = "customPresetSource";
    state.cursor = 0;
    state.textInput = url;

    const { effect } = handleCustomSourceTextInputKey(state, "enter", "/project");

    // No scan effect: there is nothing to list until it is cloned.
    expect(effect).toEqual({ type: "none" });
    expect(state.customPresetSource).toBe(url);
    expect(state.presetSourceMode as string).toBe("custom");
    expect(state.notice).toBe("");
    expect(state.screen as string).toBe("presets");
    expect(remotePresetRef(state)).toBe(url);
  });

  it("does not leak a presets-only remote ref into another flow", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = "https://github.com/o/preset";
    expect(remotePresetRef(state)).toBe("https://github.com/o/preset");

    // Switching to the custom-base flow must not drag the preset URL along with it.
    handleTuiKey(state, "escape");
    state.flow = "custom";
    expect(remotePresetRef(state)).toBeUndefined();
  });

  it("clears a stale preset location when the flow changes", () => {
    const state = createInitialState();
    state.screen = "flow";
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = "https://github.com/o/preset";

    // Pick "Use custom source" from the flow screen.
    state.cursor = 2;
    handleTuiKey(state, "enter");

    expect(state.customPresetSource).toBe("");
    expect(remotePresetRef(state)).toBeUndefined();
  });

  it("reports no remote preset ref for a local directory", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = "/project/team-presets";

    expect(remotePresetRef(state)).toBeUndefined();
  });

  it("redacts credentials when displaying a pasted URL", () => {
    const credentialed = "https://user:s3cret@github.com/o/r";
    const rendered = formatSourceMode("custom", credentialed);

    expect(rendered).not.toContain("s3cret");
    expect(rendered).toContain("https://github.com/o/r");
  });
});

describe("credential persistence", () => {
  const credentialed = "https://user:s3cret@github.com/o/r";

  it("redacts credentials before remembering a recent source", () => {
    const recents = rememberCustomSource([], credentialed);

    expect(recents).toEqual(["https://github.com/o/r"]);
    expect(recents.join()).not.toContain("s3cret");
  });

  it("redacts credentials before they reach the preferences snapshot", () => {
    const state = createInitialState();
    state.flow = "custom";
    state.sourceMode = "custom";
    state.customSource = credentialed;

    const snapshot = snapshotTuiPreferences(state);

    expect(JSON.stringify(snapshot)).not.toContain("s3cret");
    expect(JSON.stringify(snapshot)).toContain("https://github.com/o/r");
  });

  it("redacts a credentialed preset ref before persisting it", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = credentialed;

    expect(JSON.stringify(snapshotTuiPreferences(state))).not.toContain("s3cret");
  });

  it("keeps the credentialed value in memory for the clone", () => {
    const state = createInitialState();
    state.flow = "custom";
    state.sourceMode = "custom";
    state.customSource = credentialed;

    snapshotTuiPreferences(state);

    // Persisting must not mutate what the clone will use.
    expect(state.customSource).toBe(credentialed);
    expect(planSource(state, "/project", "/home/u").sourceDir).toBe(credentialed);
  });
});

// 3.2: nothing checked that plan item ids are unique within a flow. `planItemCursor` (keys.ts)
// takes the first match on a duplicate, and the exhaustive `assertNeverPlanItemId` switch stays
// happy either way, so a duplicate id would silently misroute cursor navigation with no type error.
describe("planItems", () => {
  it("has unique ids for the dashboard flow", () => {
    const state = createInitialState();
    state.flow = "project";
    const items = planItems(state);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("has unique ids for the presets-only flow", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    const items = planItems(state);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});
