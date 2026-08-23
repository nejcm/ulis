/**
 * The "did the user actually scroll past every remote command" enforcement for the install-review
 * screens: a security control that blocks starting an install until every remote-command row (and
 * every warning row) has been scrolled fully into view at least once. No OpenTUI import - it reads
 * and writes scroll geometry only through `ConsentScrollRegion`, a narrow interface `app.ts` adapts
 * its `ScrollBoxRenderable`/`Renderable` panes onto. That is what makes the gate unit-testable
 * without a rendered TUI. `app.ts` owns row registration (`setRows`), the render loop that keeps
 * geometry current, and the notice/scroll/repaint side effects that follow a blocked start; this
 * module owns only the seen-tracking and the pass/fail decision.
 */
import { PRESET_INSTALL_REVIEW_START_ROW, type TuiState } from "./state-model.js";

const REVIEW_RESTORE_COOLDOWN_MS = 400;

/** Screen-space vertical extent of a mounted row, or undefined if it is not currently mounted. */
export interface RowExtent {
  readonly top: number;
  readonly height: number;
}

/** One scrollable pane, as the consent gate needs to read and nudge it. */
export interface ConsentScrollRegion {
  /** Visible viewport's screen-space top edge. */
  readonly viewportTop: number;
  /** Visible viewport height, in rows. */
  readonly viewportHeight: number;
  /** Current scroll offset; incremented to bring a row into view. */
  scrollTop: number;
  /** Extent of the row `id`, or undefined if it is not currently mounted in this region. */
  extentOf(id: string): RowExtent | undefined;
}

/** A tracked row: the scroll region it lives in, plus its row id within that region. */
export type ConsentRow = readonly [ConsentScrollRegion, string];

export class ConsentGate {
  private commandRows: readonly ConsentRow[] = [];
  private warningRows: readonly ConsentRow[] = [];
  private seenUntil = new Map<string, number>();
  private signature = "";
  private restoredAt = Number.NEGATIVE_INFINITY;
  private paintedAfterRestore = false;
  private gateNotice = "";

  /** Replaces the tracked remote-command and warning rows for the current frame. */
  setRows(commandRows: readonly ConsentRow[], warningRows: readonly ConsentRow[]): void {
    this.commandRows = commandRows;
    this.warningRows = warningRows;
  }

  isReviewStart(state: TuiState): boolean {
    return (
      (state.screen === "installReview" && state.cursor === 0) ||
      (state.screen === "presetInstallReview" && state.cursor === PRESET_INSTALL_REVIEW_START_ROW)
    );
  }

  hasRemoteReviewConsent(state: TuiState): boolean {
    return (state.screen === "installReview" || state.screen === "presetInstallReview") && this.commandRows.length > 0;
  }

  /** Identifies the reviewed content; a change re-arms the gate. Private so no caller can compute
   *  a signature at one moment and apply it at another - `syncSignature` is the only entry point. */
  private currentConsentSignature(rendererWidth: number, state: TuiState): string {
    if (state.screen !== "installReview" && state.screen !== "presetInstallReview") return "";
    return JSON.stringify([rendererWidth, state.screen, state.remoteCommandSource, state.remoteCommands]);
  }

  /** Re-arms the gate when the reviewed content has changed since the last sync. */
  syncSignature(rendererWidth: number, state: TuiState): void {
    const nextSignature = this.currentConsentSignature(rendererWidth, state);
    if (nextSignature === this.signature) return;
    this.signature = nextSignature;
    this.seenUntil.clear();
    this.restoredAt = Number.NEGATIVE_INFINITY;
    this.paintedAfterRestore = false;
    this.gateNotice = "";
  }

  /**
   * Records that a review start was blocked: sets the explanatory notice and resets the restore
   * cooldown. Returns whether there are unseen command rows left to scroll to. Callers must
   * repaint FIRST (so pane geometry reflects the current frame) and only then, if this returned
   * true, call `scrollToFirstUnseenConsentRow` - it reads geometry the repaint just rebuilt.
   */
  blockReviewStart(state: TuiState): boolean {
    const count = this.commandRows.length;
    const allSeen = this.allConsentCommandsSeen();
    const nextNotice =
      count === 0
        ? "Start action restored. Press Enter again to continue."
        : allSeen
          ? "Remote command review restored. Press Enter again to start."
          : `Review all ${count} remote command${count === 1 ? "" : "s"} before starting.`;
    if (state.notice === "" || state.notice === this.gateNotice) {
      state.notice = nextNotice;
      this.gateNotice = nextNotice;
    }

    this.restoredAt = performance.now();
    this.paintedAfterRestore = false;
    return count > 0 && !allSeen;
  }

  scrollToFirstUnseenConsentRow(): void {
    const row = this.commandRows.find((candidate) => !this.consentRowWasSeen(candidate[1]));
    if (!row) return;
    const [region, id] = row;
    const extent = region.extentOf(id);
    if (!extent) return;
    region.scrollTop += extent.top + (this.seenUntil.get(id) ?? 0) - region.viewportTop;
  }

  rowIsFullyVisible(row: ConsentRow | undefined): boolean {
    if (!row) return false;
    const [region, id] = row;
    const extent = region.extentOf(id);
    if (!extent) return false;
    return extent.top >= region.viewportTop && extent.top + extent.height <= region.viewportTop + region.viewportHeight;
  }

  /**
   * Called once per frame: extends the seen range of every command row currently on screen,
   * but only contiguously from what has already been seen - a row scrolled straight to its
   * bottom without passing through its middle does NOT count the skipped middle as seen. This
   * contiguity rule is the entire enforcement; without it a fast scroll or a jump-to-bottom
   * would satisfy `allConsentCommandsSeen` without the user ever having read the row.
   */
  markVisibleConsentRows(): void {
    for (const [region, id] of this.commandRows) {
      const extent = region.extentOf(id);
      if (!extent) continue;
      const viewportTop = region.viewportTop;
      const viewportBottom = viewportTop + region.viewportHeight;
      const targetTop = extent.top;
      const targetBottom = targetTop + extent.height;
      if (targetTop >= viewportBottom || targetBottom <= viewportTop) continue;
      const visibleStart = Math.max(0, viewportTop - targetTop);
      const visibleEnd = Math.min(extent.height, viewportBottom - targetTop);
      const seenUntil = this.seenUntil.get(id) ?? 0;
      if (visibleStart <= seenUntil) this.seenUntil.set(id, Math.max(seenUntil, visibleEnd));
    }
  }

  /** Marks the frame after a blocked start as painted; the cooldown in `reviewStartCanProceed` needs this. */
  notePainted(): void {
    this.paintedAfterRestore = true;
  }

  consentRowWasSeen(id: string): boolean {
    const row = this.commandRows.find((candidate) => candidate[1] === id);
    if (!row) return false;
    const extent = row[0].extentOf(id);
    return extent != null && (this.seenUntil.get(id) ?? 0) >= extent.height;
  }

  allConsentCommandsSeen(): boolean {
    return this.commandRows.length > 0 && this.commandRows.every(([, id]) => this.consentRowWasSeen(id));
  }

  reviewStartCanProceed(selectedRow: ConsentRow | undefined): boolean {
    const hasRemoteConsent = this.warningRows.length > 0 || this.commandRows.length > 0;
    if (!this.rowIsFullyVisible(selectedRow)) return false;
    if (!hasRemoteConsent) return true;
    return (
      this.warningRows.every((row) => this.rowIsFullyVisible(row)) &&
      this.allConsentCommandsSeen() &&
      this.paintedAfterRestore &&
      performance.now() - this.restoredAt >= REVIEW_RESTORE_COOLDOWN_MS
    );
  }
}
