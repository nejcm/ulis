import { describe, expect, it } from "bun:test";

import { isSamePath, platformConfigDir } from "./platforms.js";

describe("platform paths", () => {
  it("treats equivalent resolved paths as equal", () => {
    expect(isSamePath("/tmp/project", "/tmp/project/")).toBe(true);
    expect(isSamePath("/tmp/project/../project", "/tmp/project")).toBe(true);
  });

  it("selects home directory config layout when destination is home", () => {
    const userHome = "/tmp/home";

    expect(platformConfigDir("claude", "/tmp/home", userHome)).toBe("/tmp/home/.claude");
  });

  it("selects project config layout when destination is not home", () => {
    expect(platformConfigDir("forgecode", "/tmp/workspace", "/tmp/home")).toBe("/tmp/workspace/.forge");
  });
});
