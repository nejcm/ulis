import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { PLATFORM_DIRS, isSamePath, platformConfigDir, resolvePlatformDirSegment } from "./platforms.js";
import { createTempRoot } from "./test-utils/fs.js";

describe("platform paths", () => {
  it("treats equivalent resolved paths as equal", () => {
    expect(isSamePath("/tmp/project", "/tmp/project/")).toBe(true);
    expect(isSamePath("/tmp/project/../project", "/tmp/project")).toBe(true);
  });

  it("selects home directory config layout when destination is home", () => {
    const userHome = createTempRoot("ulis-platform-home-");
    expect(platformConfigDir("claude", userHome, userHome)).toBe(join(userHome, ".claude"));
  });

  it("selects project config layout when destination is not home", () => {
    const userHome = createTempRoot("ulis-platform-user-");
    const workspace = createTempRoot("ulis-platform-ws-");
    expect(platformConfigDir("forgecode", workspace, userHome)).toBe(join(workspace, ".forge"));
  });

  it("uses OpenCode home segment per OS and .opencode for project installs", () => {
    const userHome = createTempRoot("ulis-platform-ochome-");
    const workspace = createTempRoot("ulis-platform-ocws-");
    const homeSegment = resolvePlatformDirSegment(PLATFORM_DIRS.opencode.home);
    expect(platformConfigDir("opencode", userHome, userHome)).toBe(join(userHome, homeSegment));
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

  it("throws when no current-platform or default entry exists", () => {
    const other = process.platform === "win32" ? "linux" : "win32";

    expect(() => resolvePlatformDirSegment({ [other]: ".other" })).toThrow(
      `PLATFORM_DIRS: no path for platform "${process.platform}" and no default`,
    );
  });
});
