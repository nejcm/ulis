export const isWindows = process.platform === "win32";

export function checkPlatform(platform: NodeJS.Platform) {
  return {
    windows: platform === "win32",
    linux: platform === "linux",
    macos: platform === "darwin",
  };
}
