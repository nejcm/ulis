import { describe, expect, it, spyOn } from "bun:test";

import { ConsentGate, type ConsentRow, type ConsentScrollRegion, type RowExtent } from "./consent-gate.js";
import { createInitialState, type TuiState } from "./state-model.js";

/** In-memory stand-in for a scroll region, so the gate can be driven without OpenTUI. */
class FakeRegion implements ConsentScrollRegion {
  viewportTop = 0;
  viewportHeight = 10;
  scrollTop = 0;
  private readonly rows = new Map<string, RowExtent>();

  setExtent(id: string, extent: RowExtent): void {
    this.rows.set(id, extent);
  }

  extentOf(id: string): RowExtent | undefined {
    return this.rows.get(id);
  }
}

function reviewState(remoteCommands: readonly string[]): TuiState {
  const state = createInitialState();
  state.screen = "installReview";
  state.cursor = 0;
  state.remoteCommands = remoteCommands;
  state.remoteCommandSource = "https://example.com/setup.git";
  return state;
}

describe("ConsentGate", () => {
  it("blocks a review start until every remote command row has been seen", () => {
    const gate = new ConsentGate();
    const state = reviewState(["curl | sh", "rm -rf /tmp/x"]);

    const selectedRegion = new FakeRegion();
    selectedRegion.setExtent("selected", { top: 0, height: 1 });
    const selectedRow: ConsentRow = [selectedRegion, "selected"];

    const commandRegion = new FakeRegion();
    commandRegion.viewportHeight = 5;
    commandRegion.setExtent("row1", { top: 0, height: 5 });
    commandRegion.setExtent("row2", { top: 5, height: 5 });
    const commandRows: ConsentRow[] = [
      [commandRegion, "row1"],
      [commandRegion, "row2"],
    ];

    gate.notePainted(); // a frame has already painted, as it always has by the time a keypress arrives
    gate.setRows(commandRows, []);

    expect(gate.isReviewStart(state)).toBe(true);
    expect(gate.hasRemoteReviewConsent(state)).toBe(true);

    // Only row1 is inside the 5-row viewport; row2 is scrolled below it.
    gate.markVisibleConsentRows();
    expect(gate.consentRowWasSeen("row1")).toBe(true);
    expect(gate.consentRowWasSeen("row2")).toBe(false);
    expect(gate.allConsentCommandsSeen()).toBe(false);
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(false);

    // Scroll down so row2 comes into view and gets marked seen too.
    commandRegion.viewportTop = 5;
    gate.markVisibleConsentRows();
    expect(gate.consentRowWasSeen("row2")).toBe(true);
    expect(gate.allConsentCommandsSeen()).toBe(true);
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(true);
  });

  it("re-arms the gate when the reviewed content's signature changes", () => {
    const gate = new ConsentGate();
    const state = reviewState(["curl | sh"]);

    const selectedRegion = new FakeRegion();
    selectedRegion.setExtent("selected", { top: 0, height: 1 });
    const selectedRow: ConsentRow = [selectedRegion, "selected"];

    const commandRegion = new FakeRegion();
    commandRegion.setExtent("row1", { top: 0, height: 5 });
    const commandRows: ConsentRow[] = [[commandRegion, "row1"]];

    gate.setRows(commandRows, []);
    gate.syncSignature(80, state); // establishes the baseline signature so the next sync is a real change
    gate.notePainted();
    gate.markVisibleConsentRows();
    expect(gate.allConsentCommandsSeen()).toBe(true);
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(true);

    // The reviewed commands changed (e.g. a different remote source); re-sync the signature.
    state.remoteCommandSource = "https://example.com/other.git";
    gate.syncSignature(80, state);
    expect(gate.allConsentCommandsSeen()).toBe(false);
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(false);

    // Even marking the row visible again doesn't help until the frame paints again -
    // syncSignature also revoked "painted after restore".
    gate.markVisibleConsentRows();
    expect(gate.allConsentCommandsSeen()).toBe(true);
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(false);

    gate.notePainted();
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(true);
  });

  it("does not count a restore as painted, even once the cooldown has elapsed", () => {
    const gate = new ConsentGate();
    const state = reviewState(["curl | sh"]);

    const selectedRegion = new FakeRegion();
    selectedRegion.setExtent("selected", { top: 0, height: 1 });
    const selectedRow: ConsentRow = [selectedRegion, "selected"];

    const commandRegion = new FakeRegion();
    commandRegion.setExtent("row1", { top: 0, height: 5 });
    const commandRows: ConsentRow[] = [[commandRegion, "row1"]];

    gate.notePainted();
    gate.setRows(commandRows, []);
    gate.markVisibleConsentRows();
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(true);

    // Blocking a start resets the restore cooldown and revokes "painted after restore".
    gate.blockReviewStart(state);
    expect(state.notice).toBe("Remote command review restored. Press Enter again to start.");

    const now = spyOn(performance, "now").mockReturnValue(performance.now() + 100_000);
    try {
      // Cooldown has long since elapsed, but no frame has painted since the restore.
      expect(gate.reviewStartCanProceed(selectedRow)).toBe(false);

      gate.notePainted();
      expect(gate.reviewStartCanProceed(selectedRow)).toBe(true);
    } finally {
      now.mockRestore();
    }
  });

  it("does not count a row as seen if the scroll jumps straight to its bottom", () => {
    const gate = new ConsentGate();

    const selectedRegion = new FakeRegion();
    selectedRegion.setExtent("selected", { top: 0, height: 1 });
    const selectedRow: ConsentRow = [selectedRegion, "selected"];

    // A tall row (height 20) in a short viewport (height 5).
    const commandRegion = new FakeRegion();
    commandRegion.viewportHeight = 5;
    commandRegion.setExtent("row1", { top: 0, height: 20 });
    const commandRows: ConsentRow[] = [[commandRegion, "row1"]];

    gate.notePainted();
    gate.setRows(commandRows, []);

    // See the top 5 rows.
    gate.markVisibleConsentRows();
    expect(gate.consentRowWasSeen("row1")).toBe(false);

    // Jump straight to the bottom, skipping rows 5-14 entirely.
    commandRegion.viewportTop = 15;
    gate.markVisibleConsentRows();
    expect(gate.consentRowWasSeen("row1")).toBe(false);
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(false);

    // Filling in the skipped middle contiguously does mark it fully seen.
    commandRegion.viewportTop = 5;
    gate.markVisibleConsentRows();
    commandRegion.viewportTop = 10;
    gate.markVisibleConsentRows();
    commandRegion.viewportTop = 15;
    gate.markVisibleConsentRows();
    expect(gate.consentRowWasSeen("row1")).toBe(true);
  });

  it("blocks a start when the selected row is only partially visible", () => {
    const gate = new ConsentGate();

    // No remote commands or warnings tracked, so only the selected-row visibility check applies.
    gate.notePainted();
    gate.setRows([], []);

    const selectedRegion = new FakeRegion();
    selectedRegion.viewportHeight = 5;
    // Extends from row 3 to row 8 - the bottom 3 rows are clipped by the 5-row viewport.
    selectedRegion.setExtent("selected", { top: 3, height: 5 });
    const selectedRow: ConsentRow = [selectedRegion, "selected"];

    expect(gate.rowIsFullyVisible(selectedRow)).toBe(false);
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(false);

    // Once fully inside the viewport, the same check passes.
    selectedRegion.viewportHeight = 10;
    expect(gate.rowIsFullyVisible(selectedRow)).toBe(true);
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(true);
  });

  it("blocks a start when a warning row is not fully visible, even once every command row is seen", () => {
    const gate = new ConsentGate();

    const selectedRegion = new FakeRegion();
    selectedRegion.setExtent("selected", { top: 0, height: 1 });
    const selectedRow: ConsentRow = [selectedRegion, "selected"];

    // A command row that is fully seen, so it alone would let the gate proceed.
    const commandRegion = new FakeRegion();
    commandRegion.setExtent("row1", { top: 0, height: 5 });
    const commandRows: ConsentRow[] = [[commandRegion, "row1"]];

    // A warning row scrolled half out of view below the viewport.
    const warningRegion = new FakeRegion();
    warningRegion.viewportHeight = 5;
    warningRegion.setExtent("warn1", { top: 3, height: 5 });
    const warningRows: ConsentRow[] = [[warningRegion, "warn1"]];

    gate.notePainted();
    gate.setRows(commandRows, warningRows);
    gate.markVisibleConsentRows();
    expect(gate.allConsentCommandsSeen()).toBe(true);

    expect(gate.reviewStartCanProceed(selectedRow)).toBe(false);

    // Scrolling the warning fully into view clears the block.
    warningRegion.viewportHeight = 10;
    expect(gate.reviewStartCanProceed(selectedRow)).toBe(true);
  });
});
