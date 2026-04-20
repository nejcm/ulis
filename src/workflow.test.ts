import { describe, expect, it } from "bun:test";

import { parsePlatformList } from "./platforms.js";
import { resolveWorkflowPlan, toggleAllPlatformSelections, togglePlatformSelection } from "./workflow.js";

describe("parsePlatformList", () => {
  it("parses comma-separated values and preserves canonical ordering", () => {
    expect(parsePlatformList(["cursor,claude", "opencode"])).toEqual(["opencode", "claude", "cursor"]);
  });

  it("throws for unknown platforms", () => {
    expect(() => parsePlatformList(["claude,unknown"])).toThrow("Unknown platform");
  });
});

describe("workflow helpers", () => {
  it("builds the union of generation and install targets", () => {
    expect(resolveWorkflowPlan(["claude"], ["cursor", "claude"])).toEqual({
      buildTargets: ["claude", "cursor"],
      installTargets: ["claude", "cursor"],
    });
  });

  it("toggles a platform while keeping canonical ordering", () => {
    expect(togglePlatformSelection(["cursor"], "claude")).toEqual(["claude", "cursor"]);
    expect(togglePlatformSelection(["claude", "cursor"], "claude")).toEqual(["cursor"]);
  });

  it("toggles all platforms on and off", () => {
    expect(toggleAllPlatformSelections(["claude"])).toEqual(["opencode", "claude", "codex", "cursor"]);
    expect(toggleAllPlatformSelections(["opencode", "claude", "codex", "cursor"])).toEqual([]);
  });
});
