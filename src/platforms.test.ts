import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isSamePath, platformConfigDir, resolvePlatformDirSegment } from "./platforms.js";

describe("platform paths", () => {
  it("treats equivalent resolved paths as equal", () => {
    expect(isSamePath("/tmp/project", "/tmp/project/")).toBe(true);
    expect(isSamePath("/tmp/project/../project", "/tmp/project")).toBe(true);
  });

  it("selects home directory config layout when destination is home", () => {
    const userHome = mkdtempSync(join(tmpdir(), "ulis-platform-home-"));
    expect(platformConfigDir("claude", userHome, userHome)).toBe(join(userHome, ".claude"));
  });

  it("selects project config layout when destination is not home", () => {
    const userHome = mkdtempSync(join(tmpdir(), "ulis-platform-user-"));
    const workspace = mkdtempSync(join(tmpdir(), "ulis-platform-ws-"));
    expect(platformConfigDir("forgecode", workspace, userHome)).toBe(join(workspace, ".forge"));
  });

  it("uses OpenCode global dir under .config and .opencode for project installs", () => {
    const userHome = mkdtempSync(join(tmpdir(), "ulis-platform-ochome-"));
    const workspace = mkdtempSync(join(tmpdir(), "ulis-platform-ocws-"));
    expect(platformConfigDir("opencode", userHome, userHome)).toBe(join(userHome, ".config/opencode"));
    expect(platformConfigDir("opencode", workspace, userHome)).toBe(join(workspace, ".opencode"));
  });
});

describe("resolvePlatformDirSegment", () => {
  it("returns plain strings unchanged", () => {
    expect(resolvePlatformDirSegment(".claude")).toBe(".claude");
  });

  it("selects the entry for the current process.platform", () => {
    const plat = process.platform;
    expect(resolvePlatformDirSegment({ [plat]: ".from-map", default: ".fallback" })).toBe(".from-map");
  });

  it("falls back to default when the current platform has no entry", () => {
    const other = process.platform === "win32" ? "linux" : "win32";
    expect(resolvePlatformDirSegment({ [other]: ".other", default: ".fallback" })).toBe(".fallback");
  });
});
