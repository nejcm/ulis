import { afterEach, describe, expect, it } from "bun:test";

const clipboardModule = (await import(`./clipboard.ts?real=${Date.now()}`)) as typeof import("./clipboard.js");
const { __test, readClipboardText, writeClipboardText } = clipboardModule;

const calls: Array<{ command: string; args: readonly string[] }> = [];

function setClipboardResult(stdout: string, status = 0): void {
  __test.setRuntimeDependencies({
    spawnSync: ((command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return { stdout, status };
    }) as never,
  });
}

describe("readClipboardText", () => {
  afterEach(() => {
    calls.length = 0;
    __test.resetRuntimeDependencies();
  });

  it("uses pbpaste on macOS", () => {
    __test.setRuntimeDependencies({ platform: "darwin" });
    setClipboardResult("/tmp/source\n");

    expect(readClipboardText()).toBe("/tmp/source");
    expect(calls[0]).toEqual({ command: "pbpaste", args: [] });
  });

  it("uses wl-paste first on Linux", () => {
    __test.setRuntimeDependencies({ platform: "linux" });
    setClipboardResult("/tmp/source");

    expect(readClipboardText()).toBe("/tmp/source");
    expect(calls[0]).toEqual({ command: "wl-paste", args: ["--no-newline"] });
  });

  it("uses Get-Clipboard on Windows", () => {
    __test.setRuntimeDependencies({ platform: "win32" });
    setClipboardResult("C:\\source\r\n");

    expect(readClipboardText()).toBe("C:\\source");
    expect(calls[0]?.command).toBe("powershell.exe");
  });
});

describe("writeClipboardText", () => {
  afterEach(() => {
    calls.length = 0;
    __test.resetRuntimeDependencies();
  });

  it("falls through to the next Linux tool when one is missing", () => {
    __test.setRuntimeDependencies({
      platform: "linux",
      spawnSync: ((command: string, args: readonly string[]) => {
        calls.push({ command, args });
        return { status: command === "wl-copy" ? null : 0 };
      }) as never,
    });

    expect(writeClipboardText("ulis install")).toBe(true);
    expect(calls.map((call) => call.command)).toEqual(["wl-copy", "xclip"]);
  });

  it("reports failure when no tool accepts the text", () => {
    __test.setRuntimeDependencies({ platform: "darwin", spawnSync: (() => ({ status: 1 })) as never });

    expect(writeClipboardText("ulis install")).toBe(false);
  });
});
