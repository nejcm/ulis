import { describe, expect, it } from "bun:test";

import { splitLogTag } from "./render.js";

describe("splitLogTag", () => {
  it("separates colored status tags from unstyled message text", () => {
    expect(splitLogTag("[info] Installing * skill: microsoft/playwright-cli")).toEqual({
      text: "Installing * skill: microsoft/playwright-cli",
      logTag: { text: "[info]", fgColor: "color06" },
    });
    expect(splitLogTag("[done] * skill: microsoft/playwright-cli")).toEqual({
      text: "* skill: microsoft/playwright-cli",
      logTag: { text: "[done]", fgColor: "color02" },
    });
    expect(splitLogTag("[warn] Failed to install * skill: bad/repo")).toEqual({
      text: "Failed to install * skill: bad/repo",
      logTag: { text: "[warn]", fgColor: "color03" },
    });
    expect(splitLogTag("[error] install failed")).toEqual({
      text: "install failed",
      logTag: { text: "[error]", fgColor: "color01" },
    });
  });

  it("keeps untagged log lines unstyled", () => {
    expect(splitLogTag("=== Installing External Skills ===")).toEqual({ text: "=== Installing External Skills ===" });
  });

  it("separates the status tag from multiline diagnostics", () => {
    expect(splitLogTag("[error] Invalid config\n  path: .ulis/ulis.yaml")).toEqual({
      text: "Invalid config\n  path: .ulis/ulis.yaml",
      logTag: { text: "[error]", fgColor: "color01" },
    });
  });
});
