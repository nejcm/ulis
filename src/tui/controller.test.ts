import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";

import { __test as installTest } from "../install.js";
import { TuiController, type TuiControllerOptions } from "./controller.js";
import { handleTuiKey } from "./keys.js";
import { planItems, reviewFingerprint } from "./selectors.js";
import { PRESET_INSTALL_REVIEW_START_ROW, type TuiState } from "./state-model.js";
import { MIN_COLUMNS, MIN_ROWS, SPLIT_COLUMNS } from "./view.js";

/** Comfortably above `key-codes.ts`'s 35 ms duplicate-key window. */
const KEY_DELAY_MS = 60;

const tmpRoots: string[] = [];
const activeRenderers: { destroy: () => void }[] = [];

function preferencesPath(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-tui-controller-"));
  tmpRoots.push(root);
  return join(root, ".ulis-tui.json");
}

interface Harness extends TestRendererSetup {
  controller: TuiController;
  exitCodes: number[];
  frame: () => Promise<string>;
  press: (...keys: string[]) => Promise<void>;
}

async function scrollWithPaint(
  harness: Harness,
  x: number,
  y: number,
  direction: "up" | "down",
  steps: number,
): Promise<void> {
  for (let index = 0; index < steps; index += 1) {
    await harness.mockMouse.scroll(x, y, direction);
    await harness.renderOnce();
  }
}

async function pageDownWithPaint(harness: Harness, steps: number, painted?: Set<number>): Promise<void> {
  for (let index = 0; index < steps; index += 1) {
    harness.mockInput.pressKey("\x1b[6~");
    harness.controller.render();
    await harness.renderOnce();
    if (painted) {
      const frame = harness.captureCharFrame();
      for (let segment = 0; segment < 12; segment += 1) {
        if (frame.includes(`seg${segment}-`)) painted.add(segment);
      }
    }
  }
}

async function createHarness(
  width = 100,
  height = 30,
  options: Omit<TuiControllerOptions, "exit"> = {},
): Promise<Harness> {
  const setup = await createTestRenderer({ width, height });
  activeRenderers.push(setup.renderer);
  const exitCodes: number[] = [];
  const controller = new TuiController(setup.renderer, {
    exit: (code) => exitCodes.push(code),
    writeStderr: () => {},
    listPresets: () => [],
    preferencesPath: options.preferencesPath ?? preferencesPath(),
    ...options,
  });
  controller.render();
  await setup.renderOnce();

  const frame = async () => {
    controller.render();
    await setup.renderOnce();
    return setup.captureCharFrame();
  };
  const press = async (...keys: string[]) => {
    for (const key of keys) await setup.mockInput.pressKeys([key], KEY_DELAY_MS);
    controller.render();
    await setup.renderOnce();
  };

  return { ...setup, controller, exitCodes, frame, press };
}

afterEach(() => {
  // Each test renderer registers process-level listeners; drop them so long runs
  // do not trip Node's max-listener warning.
  for (const renderer of activeRenderers.splice(0)) renderer.destroy();
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("TUI layout", () => {
  it.each([
    ["installReview", "install", 0, "Start install", ["Back to plan"]],
    [
      "presetInstallReview",
      "presetInstall",
      PRESET_INSTALL_REVIEW_START_ROW,
      "Start preset install",
      [
        "Backup existing configs before install",
        "Prune removed agents and skills",
        "Run preset extensions",
        "Back to presets",
      ],
    ],
  ] as const)(
    "gates %s on reviewing every remote command at minimum size",
    async (screen, action, cursor, label, normalActions) => {
      const harness = await createHarness(MIN_COLUMNS, MIN_ROWS);
      const state = harness.controller.state;
      state.screen = screen;
      state.cursor = cursor;
      state.remoteCommandSource = "https://github.com/acme/remote";
      state.remoteCommands = Array.from({ length: 24 }, (_, index) => `remote command ${index + 1}`);
      const fingerprint = reviewFingerprint(state, action);

      const frame = await harness.frame();
      expect(frame).toContain(`> ${label}`);
      expect(frame).toContain("REMOTE: 24 entries WILL apply");
      expect(frame).toContain("@ github.com/acme/remote");
      expect(frame).toMatch(/Source|Preset location/u);
      expect(frame).not.toMatch(/remote command \d+/u);

      await harness.press("RETURN");
      expect(state.screen).toBe(screen);
      const reviewFrame = await harness.frame();
      expect(reviewFrame).toContain("remote command 1");
      expect(reviewFrame).toContain("Review all 24 remote commands before starting.");
      expect(reviewFrame).toContain("REMOTE: 24 entries WILL apply");
      expect(reviewFrame).toContain("@ github.com/acme/remote");
      expect(reviewFrame).toContain(`> ${label}`);
      expect(reviewFingerprint(state, action)).toBe(fingerprint);

      await scrollWithPaint(harness, 20, 4, "down", 40);
      const endFrame = harness.captureCharFrame();
      expect(endFrame).toContain("remote command 24");
      expect(endFrame).toContain("REMOTE: 24 entries WILL apply");
      expect(endFrame).toContain("@ github.com/acme/remote");
      expect(endFrame).toContain(`> ${label}`);

      const normalHarness = await createHarness(100, 30);
      Object.assign(normalHarness.controller.state, {
        screen,
        cursor,
        remoteCommandSource: "https://github.com/acme/remote",
        remoteCommands: state.remoteCommands,
      });
      const normalFrame = await normalHarness.frame();
      expect(normalFrame).toContain("REMOTE: 24 entries WILL apply");
      expect(normalFrame).toContain("@ github.com/acme/remote");
      expect(normalFrame).toContain("Destination");
      expect(normalFrame).toContain(`> ${label}`);
      for (const actionLabel of normalActions) expect(normalFrame).toContain(actionLabel);
    },
  );

  it("keeps the remote host visible and escapes display controls in the warning", async () => {
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS);
    Object.assign(harness.controller.state, {
      screen: "installReview",
      cursor: 0,
      remoteCommands: Array.from({ length: 24 }, (_, index) => `remote command ${index + 1}`),
      remoteCommandSource: "https://github.com/acme/actions-checkout-evil-with-a-long-tail",
    });

    const githubFrame = await harness.frame();
    const githubSource = githubFrame.split("\n").find((line) => line.includes("@ github.com"));
    expect(githubFrame).toContain("REMOTE: 24 entries WILL apply");
    expect(githubSource).toContain("github.com/");
    expect(githubSource).toContain("…");
    expect(githubSource).toContain("long-tail");

    const wideHarness = await createHarness(100, 30);
    Object.assign(wideHarness.controller.state, harness.controller.state);
    const wideFrame = await wideHarness.frame();
    expect(wideFrame).toContain("github.com/acme/actions-checkout-evil-with-a-long-tail");
    expect(wideFrame).not.toContain("…");

    harness.controller.state.remoteCommandSource = "https://evil.com/acme/actions-checkout-evil-with-a-long-tail";
    const evilFrame = await harness.frame();
    const evilSource = evilFrame.split("\n").find((line) => line.includes("@ evil.com"));
    expect(evilSource).toContain("evil.com/");
    expect(evilSource).toContain("…");
    expect(evilSource).toContain("long-tail");
    expect(evilSource).not.toBe(githubSource);

    harness.controller.state.remoteCommandSource = "ssh://git@github.com/acme/actions-checkout-evil-with-a-long-tail";
    const sshFrame = await harness.frame();
    expect(sshFrame).toContain("@ github.com/acme/actions-ch…with-a-long-tail");

    harness.controller.state.remoteCommandSource = "https://evil.com/a\u202Eb\u200B";
    const bidiFrame = await harness.frame();
    expect(bidiFrame).toContain("evil.com/a\\u202eb\\u200b");
    expect(bidiFrame).not.toContain("\u202E");
    expect(bidiFrame).not.toContain("\u200B");

    harness.controller.state.remoteCommandSource = "https://x.co/a\u200Cb\u200D";
    harness.controller.state.remoteCommands = ["echo a\u200Cb\u200D"];
    await harness.frame();
    await pageDownWithPaint(harness, 2);
    const consentFrame = harness.captureCharFrame();
    const commandLine = consentFrame.split("\n").find((line) => line.includes("echo"));
    expect(consentFrame).toContain("x.co/a\\u200cb\\u200d");
    expect(commandLine).toContain("echo a\\u200cb\\u200d");
    expect(commandLine).not.toContain("\u200C");
    expect(commandLine).not.toContain("\u200D");
  });

  it.each([
    ["installReview", 0],
    ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW],
  ] as const)("keeps an overlong remote host readable and confirmable on %s", async (screen, cursor) => {
    let runs = 0;
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS, {
      runAction: async () => {
        runs += 1;
      },
    });
    Object.assign(harness.controller.state, {
      screen,
      cursor,
      remoteCommands: ["remote command"],
      remoteCommandSource: `https://${"h".repeat(80)}.example.com/repo`,
    });

    const frame = await harness.frame();
    const sourceLine = frame.split("\n").find((line) => line.includes("@ h"));
    expect(frame).toContain("REMOTE: 1 entry WILL apply");
    expect(frame).toContain("> Start");
    expect(frame).toContain("Bksp:");
    expect(frame).toContain("back");
    if (screen === "installReview") expect(frame).toContain("Back to plan");
    expect(sourceLine).toContain("hhhh");
    expect(sourceLine).toContain("…");
    expect(sourceLine).toContain(".example.com");

    await pageDownWithPaint(harness, 3);
    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(runs).toBe(1);
  });

  it("keeps full-width remote hosts readable and confirmable at minimum size", async () => {
    const hosts = [
      ["40 CJK", `始${"界".repeat(38)}終.example.com`],
      ["200 CJK", `始${"界".repeat(198)}終.example.com`],
      ["40 full-width Latin", `ａ${"ｂ".repeat(38)}ｚ.example.com`],
      ["200 full-width Latin", `ａ${"ｂ".repeat(198)}ｚ.example.com`],
      ["mixed", `ascii-${"界".repeat(40)}-tail.example.com`],
    ] as const;
    const reviews = [
      ["installReview", 0],
      ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW],
    ] as const;

    for (const [screen, cursor] of reviews) {
      for (const [label, host] of hosts) {
        let runs = 0;
        const harness = await createHarness(MIN_COLUMNS, MIN_ROWS, {
          runAction: async () => {
            runs += 1;
          },
        });
        Object.assign(harness.controller.state, {
          screen,
          cursor,
          remoteCommands: ["remote command"],
          remoteCommandSource: `https://${host}/org/repo`,
        });

        const frame = await harness.frame();
        const sourceLine = frame.split("\n").find((line) => line.includes("@ "));
        expect(frame, `${screen} ${label}`).toContain("REMOTE: 1 entry WILL apply");
        expect(frame, `${screen} ${label}`).toContain("> Start");
        if (screen === "installReview") expect(frame, `${screen} ${label}`).toContain("Back to plan");
        expect(sourceLine, `${screen} ${label}`).toContain("…");
        expect(sourceLine, `${screen} ${label}`).toContain(".example.com");

        await pageDownWithPaint(harness, 3);
        await harness.press("RETURN");
        await Bun.sleep(0);
        expect(runs, `${screen} ${label}`).toBe(1);
        harness.renderer.destroy();
      }
    }
  }, 15_000);

  it("keeps a VS16 emoji host from displacing the remote warning", async () => {
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS);
    Object.assign(harness.controller.state, {
      screen: "installReview",
      cursor: 0,
      remoteCommands: ["remote command"],
      remoteCommandSource: `https://${"❤️".repeat(40)}.example.com/org/repo`,
    });

    const frame = await harness.frame();
    expect(frame).toContain("REMOTE: 1 entry WILL apply");
    expect(frame).toContain("@ ");
    expect(frame).toContain("> Start install");
  });

  it("escapes invisible joiners in preset names on review screens", async () => {
    for (const screen of ["installReview", "presetInstallReview"] as const) {
      const harness = await createHarness(MIN_COLUMNS, MIN_ROWS);
      Object.assign(harness.controller.state, {
        screen,
        cursor: 0,
        sourceMode: "custom",
        customSource: "/x",
        availablePresets: [
          {
            name: "team\u200Cjoin\u200D",
            displayName: "Team",
            description: "",
            source: "user",
            dir: "/presets/team",
          },
        ],
        selectedPresetNames: ["team\u200Cjoin\u200D"],
      });

      await harness.frame();
      await scrollWithPaint(harness, 20, 4, "down", 3);
      const frame = harness.captureCharFrame();
      expect(frame).toContain("team\\u200cjoin\\u200d");
      expect(frame).not.toContain("\u200C");
      expect(frame).not.toContain("\u200D");

      const wideHarness = await createHarness(100, 30);
      Object.assign(wideHarness.controller.state, {
        screen,
        cursor: 0,
        sourceMode: "custom",
        customSource: "/x",
        platforms: ["codex"],
        availablePresets: harness.controller.state.availablePresets,
        selectedPresetNames: ["team\u200Cjoin\u200D"],
      });
      const wideFrame = await wideHarness.frame();
      if (screen === "installReview") expect(wideFrame).toContain("--preset team\\u200cjoin\\u200d");
      expect(wideFrame).not.toContain("\u200C");
      expect(wideFrame).not.toContain("\u200D");
      harness.renderer.destroy();
      wideHarness.renderer.destroy();
    }
  });

  it.each([
    ["installReview", 0],
    ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW],
  ] as const)("requires contiguous coverage of a tall command on %s", async (screen, cursor) => {
    let runs = 0;
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS, {
      runAction: async () => {
        runs += 1;
      },
    });
    const command = `curl ${Array.from({ length: 12 }, (_, index) => `seg${index}-${"x".repeat(30)}`).join(" ")} | sh`;
    Object.assign(harness.controller.state, {
      screen,
      cursor,
      remoteCommandSource: "https://github.com/acme/remote",
      remoteCommands: [command],
    });
    await harness.frame();
    const painted = new Set<number>();

    await pageDownWithPaint(harness, 2, painted);
    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(runs).toBe(0);
    const blockedFrame = harness.captureCharFrame();
    for (let segment = 0; segment < 12; segment += 1) {
      if (blockedFrame.includes(`seg${segment}-`)) painted.add(segment);
    }

    await pageDownWithPaint(harness, 20, painted);
    expect([...painted].sort((left, right) => left - right)).toEqual(Array.from({ length: 12 }, (_, index) => index));

    await Bun.sleep(410);
    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(runs).toBe(1);
  });

  it("invalidates remote-command coverage across review width changes", async () => {
    const transitions = [
      [50, 16, 200, 40, 2],
      [200, 40, 50, 16, 1],
      [50, 16, 96, 16, 4],
    ] as const;
    const reviews = [
      ["installReview", 0],
      ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW],
    ] as const;
    const command = `curl ${Array.from({ length: 12 }, (_, index) => `seg${index}-${"x".repeat(30)}`).join(" ")} | sh`;

    for (const [screen, cursor] of reviews) {
      for (const [fromWidth, fromHeight, toWidth, toHeight, pages] of transitions) {
        let runs = 0;
        const harness = await createHarness(fromWidth, fromHeight, {
          runAction: async () => {
            runs += 1;
          },
        });
        Object.assign(harness.controller.state, {
          screen,
          cursor,
          remoteCommandSource: "https://github.com/acme/remote",
          remoteCommands: [command],
        });

        await harness.frame();
        await pageDownWithPaint(harness, pages);
        harness.resize(toWidth, toHeight);
        await harness.renderOnce();
        await Bun.sleep(410);
        await harness.press("RETURN");
        await Bun.sleep(0);

        expect(runs, `${screen} ${fromWidth}x${fromHeight} -> ${toWidth}x${toHeight}`).toBe(0);
        expect(harness.controller.state.screen).toBe(screen);
        harness.renderer.destroy();
      }
    }
  }, 15_000);

  it.each([
    ["installReview", 0, "Start install"],
    ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW, "Start preset install"],
  ] as const)("gates %s on a remote source whose recognised plan is empty", async (screen, cursor, label) => {
    let runs = 0;
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS, {
      runAction: async () => {
        runs += 1;
      },
    });
    Object.assign(harness.controller.state, {
      screen,
      cursor,
      remoteCommandSource: "https://github.com/acme/remote",
      remoteCommands: [],
    });

    const frame = await harness.frame();
    expect(frame).toContain("REMOTE:");
    expect(frame).toContain("@ github.com/acme/remote");
    expect(frame).toContain(`> ${label}`);

    // Nothing recognised as executable still means an unreviewed tree lands in the destination,
    // so the first Enter must acknowledge the gate rather than start the install.
    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(runs).toBe(0);
    expect(harness.controller.state.screen).toBe(screen);
    const blocked = harness.captureCharFrame();
    expect(blocked).toContain("Review all 1 remote command before starting.");
    expect(blocked).toContain("Its files will still be installed for:");

    await pageDownWithPaint(harness, 6);
    await Bun.sleep(410);
    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(runs).toBe(1);
  });

  it("keeps remote-command coverage across a review height change", async () => {
    // Rows wrap by width alone, so a height-only resize does not invalidate the record of which
    // lines were painted - what was seen was seen. Only width is part of the consent signature.
    let runs = 0;
    const harness = await createHarness(50, 20, {
      runAction: async () => {
        runs += 1;
      },
    });
    Object.assign(harness.controller.state, {
      screen: "installReview",
      cursor: 0,
      remoteCommandSource: "https://github.com/acme/remote",
      remoteCommands: ["remote command 1", "remote command 2"],
    });

    await harness.frame();
    await pageDownWithPaint(harness, 6);
    harness.resize(50, 30);
    await harness.renderOnce();
    await Bun.sleep(410);
    await harness.press("RETURN");
    await Bun.sleep(0);

    expect(runs).toBe(1);
  });

  it("budgets wrapped action text by rendered lines", async () => {
    const harness = await createHarness(50, 24);
    Object.assign(harness.controller.state, {
      screen: "presetInstallReview",
      cursor: PRESET_INSTALL_REVIEW_START_ROW,
      presetSourceMode: "custom",
      presetInstallExtensions: true,
      remoteCommandSource: "https://github.com/acme/remote",
      remoteCommands: ["remote command"],
    });

    const frame = await harness.frame();
    for (const text of [
      "Backup existing configs",
      "Prune removed agents",
      "Run preset extensions",
      "Warning: extensions.yaml",
      "REMOTE: 1 entry WILL apply",
      "@ github.com/acme/remote",
      "> Start preset install",
      "Back to presets",
    ]) {
      expect(frame).toContain(text);
    }
  });

  it("requires preset install confirmation to be visible after action-pane scrolling", async () => {
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS);
    const state = harness.controller.state;
    state.screen = "presetInstallReview";
    state.cursor = PRESET_INSTALL_REVIEW_START_ROW;
    state.remoteCommandSource = "https://github.com/acme/remote";
    state.remoteCommands = Array.from({ length: 24 }, (_, index) => `remote command ${index + 1}`);
    await harness.frame();

    await harness.mockMouse.scroll(20, 8, "up");
    await harness.mockMouse.scroll(20, 8, "up");
    await harness.renderOnce();
    const scrolledFrame = harness.captureCharFrame();
    expect(scrolledFrame).not.toContain("> Start preset install");

    await harness.press("RETURN");
    expect(state.screen).toBe("presetInstallReview");
    const restoredFrame = await harness.frame();
    expect(restoredFrame).toContain("REMOTE: 24 entries WILL apply");
    expect(restoredFrame).toContain("@ github.com/acme/remote");
    expect(restoredFrame).toContain("> Start preset install");
    expect(restoredFrame).toMatch(/remote command \d+/u);
    expect(restoredFrame).toContain("Review all 24 remote commands before starting.");
  });

  it("does not replace a contextual notice when remote review blocks start", async () => {
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS);
    Object.assign(harness.controller.state, {
      screen: "installReview",
      cursor: 0,
      notice: "Preferences were written by a newer ULIS version.",
      remoteCommandSource: "https://github.com/acme/remote",
      remoteCommands: ["remote command 1", "remote command 2"],
    });

    await harness.frame();
    await harness.press("RETURN");

    expect(harness.controller.state.screen).toBe("installReview");
    expect(harness.controller.state.notice).toBe("Preferences were written by a newer ULIS version.");
  });

  it.each([
    ["installReview", 0, "Start install"],
    ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW, "Start preset install"],
  ] as const)("requires the end of a wrapped %s command to be reviewed", async (screen, cursor, label) => {
    let runs = 0;
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS, {
      runAction: async () => {
        runs += 1;
      },
    });
    Object.assign(harness.controller.state, {
      screen,
      cursor,
      remoteCommandSource: "https://github.com/acme/remote",
      remoteCommands: [`curl ${"x".repeat(400)} | sh`],
    });
    const frame = await harness.frame();
    expect(frame).toContain("REMOTE: 1 entry WILL apply");
    expect(frame).toContain("@ github.com/acme/remote");
    expect(frame).toContain(`> ${label}`);

    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(harness.controller.state.screen).toBe(screen);
    expect(runs).toBe(0);
    const restoredFrame = await harness.frame();
    expect(restoredFrame).toContain("curl");
    expect(restoredFrame).toContain("Review all 1 remote command before starting.");

    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(runs).toBe(0);

    await scrollWithPaint(harness, 20, 4, "down", 30);
    await Bun.sleep(410);
    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(runs).toBe(1);
  });

  it.each([
    ["installReview", 0],
    ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW],
  ] as const)("requires a cooldown after restoring %s consent", async (screen, cursor) => {
    let runs = 0;
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS, {
      runAction: async () => {
        runs += 1;
      },
    });
    Object.assign(harness.controller.state, {
      screen,
      cursor,
      remoteCommandSource: "https://github.com/acme/remote",
      remoteCommands: ["remote command 1"],
    });

    await harness.frame();
    await harness.press("RETURN");
    expect(runs).toBe(0);

    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(harness.controller.state.screen).toBe(screen);
    expect(runs).toBe(0);

    await Bun.sleep(410);
    await harness.press("RETURN");
    await Bun.sleep(0);
    expect(runs).toBe(1);
  });

  it.each([
    ["installReview", 0, "Start install", "key"],
    ["installReview", 0, "Start install", "mouse"],
    ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW, "Start preset install", "key"],
    ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW, "Start preset install", "mouse"],
  ] as const)("blocks rapid double confirmation on %s before review", async (screen, cursor, label, input) => {
    let runs = 0;
    const harness = await createHarness(MIN_COLUMNS, MIN_ROWS, {
      runAction: async () => {
        runs += 1;
      },
    });
    Object.assign(harness.controller.state, {
      screen,
      cursor,
      remoteCommandSource: "https://github.com/acme/remote",
      remoteCommands: Array.from({ length: 24 }, (_, index) => `remote command ${index + 1}`),
    });
    const frame = await harness.frame();
    const startRow = frame.split("\n").findIndex((line) => line.includes(`> ${label}`));
    expect(startRow).toBeGreaterThan(0);

    if (input === "key") {
      harness.mockInput.pressKey("RETURN");
      harness.mockInput.pressKey("RETURN");
    } else {
      await harness.mockMouse.doubleClick(10, startRow, undefined, { delayMs: 1 });
    }
    await Bun.sleep(0);

    expect(harness.controller.state.screen).toBe(screen);
    expect(runs).toBe(0);
  });

  it("reaches acceptance by PageDown after every remote command is painted across supported layouts", async () => {
    const sizes = [
      [50, 16],
      [50, 17],
      [96, 16],
      [200, 24],
      [60, 40],
    ] as const;
    const reviews = [
      ["installReview", 0],
      ["presetInstallReview", PRESET_INSTALL_REVIEW_START_ROW],
    ] as const;

    for (const [width, height] of sizes) {
      for (const count of [1, 24] as const) {
        for (const [screen, cursor] of reviews) {
          let runs = 0;
          const harness = await createHarness(width, height, {
            runAction: async () => {
              runs += 1;
            },
          });
          Object.assign(harness.controller.state, {
            screen,
            cursor,
            remoteCommandSource: "https://github.com/acme/remote",
            remoteCommands:
              count === 1
                ? [`curl ${"x".repeat(400)} | sh`]
                : Array.from({ length: count }, (_, index) => `remote command ${index + 1}`),
          });

          await harness.frame();
          await pageDownWithPaint(harness, 60);
          await harness.press("RETURN");
          await Bun.sleep(0);

          expect(runs, `${screen} ${width}x${height} with ${count} command(s)`).toBe(1);
          harness.renderer.destroy();
        }
      }
    }
  }, 30_000);

  it("renders the start screen with its options and control hints", async () => {
    const harness = await createHarness();
    const frame = await harness.frame();

    expect(frame).toContain(" _   _ _     ___ ____");
    expect(frame).toContain("Update this project");
    expect(frame).toContain("Update global configs");
    expect(frame).toContain("Enter: select");
    expect(frame).toContain("q: quit");
  });

  it("shows plan panes side by side on wide terminals", async () => {
    const harness = await createHarness(SPLIT_COLUMNS + 4, 30);
    await harness.press("ARROW_DOWN", "RETURN");
    const frame = await harness.frame();

    const splitLine = frame.split("\n").find((line) => line.includes("Summary") && line.includes("Actions"));
    expect(splitLine).toBeDefined();
    expect(splitLine!.indexOf("Actions")).toBeLessThan(splitLine!.indexOf("Summary"));
  });

  it("stacks plan panes on narrow terminals", async () => {
    const harness = await createHarness(SPLIT_COLUMNS - 16, 30);
    await harness.press("ARROW_DOWN", "RETURN");
    const frame = await harness.frame();

    expect(frame).toContain("Summary");
    expect(frame).toContain("Actions");
    expect(frame.split("\n").some((line) => line.includes("Summary") && line.includes("Actions"))).toBe(false);
    const lines = frame.split("\n");
    expect(lines.findIndex((line) => line.includes("Summary"))).toBeLessThan(
      lines.findIndex((line) => line.includes("Actions")),
    );
  });

  it("replaces the UI with a resize prompt below the minimum size", async () => {
    const harness = await createHarness(MIN_COLUMNS - 10, MIN_ROWS - 4);
    const frame = await harness.frame();

    expect(frame).toContain("Terminal too small");
    expect(frame).toContain(`${MIN_COLUMNS}x${MIN_ROWS}`);
    expect(frame).not.toContain("Update this project");
  });

  it("restores the full UI when the terminal grows back", async () => {
    const harness = await createHarness(MIN_COLUMNS - 10, MIN_ROWS - 4);
    expect(await harness.frame()).toContain("Terminal too small");

    harness.resize(100, 30);
    const frame = await harness.frame();
    expect(frame).not.toContain("Terminal too small");
    expect(frame).toContain("Update this project");
  });

  it("ignores workflow keys while the terminal is too small", async () => {
    const harness = await createHarness(MIN_COLUMNS - 1, MIN_ROWS - 1);
    await harness.press("RETURN", "ARROW_DOWN");

    expect(harness.controller.state.screen).toBe("flow");
    expect(harness.controller.state.cursor).toBe(0);
  });

  it("keeps long field values from overwriting their labels", async () => {
    const harness = await createHarness(SPLIT_COLUMNS + 4, 30);
    await harness.press("ARROW_DOWN", "RETURN");
    const frame = await harness.frame();

    const line = frame.split("\n").find((row) => row.includes("Base source"));
    expect(line).toBeDefined();
    expect(line).toMatch(/Base source\s/u);
  });
});

describe("TUI keyboard control", () => {
  it("moves the cursor with arrows and with j/k", async () => {
    const harness = await createHarness();
    expect(harness.controller.state.cursor).toBe(0);

    await harness.press("ARROW_DOWN");
    expect(harness.controller.state.cursor).toBe(1);

    await harness.press("j");
    expect(harness.controller.state.cursor).toBe(2);

    await harness.press("k", "ARROW_UP");
    expect(harness.controller.state.cursor).toBe(0);
  });

  it("enters a flow and returns with backspace", async () => {
    const harness = await createHarness();
    await harness.press("RETURN");
    expect(harness.controller.state.screen).toBe("plan");

    await harness.press("BACKSPACE");
    expect(harness.controller.state.screen).not.toBe("plan");
  });

  it("quits with q", async () => {
    const harness = await createHarness();
    await harness.press("q");
    expect(harness.exitCodes).toEqual([0]);
  });

  it("quits with Ctrl+C even while the path editor holds focus", async () => {
    const harness = await createHarness();
    harness.controller.state.screen = "customSource";
    harness.controller.state.cursor = 0;
    harness.controller.render();
    await harness.renderOnce();

    harness.mockInput.pressCtrlC();
    expect(harness.exitCodes).toEqual([0]);
  });
});

describe("TUI mouse control", () => {
  it("keeps non-review Enter behavior after wheel scrolling", async () => {
    const harness = await createHarness(80, 20);
    await harness.frame();
    for (let index = 0; index < 5; index += 1) await harness.mockMouse.scroll(20, 12, "down");
    await harness.renderOnce();

    await harness.press("RETURN");
    expect(harness.controller.state.screen).toBe("plan");
  });

  it("activates the row under a click", async () => {
    const harness = await createHarness();
    const frame = await harness.frame();
    const row = frame.split("\n").findIndex((line) => line.includes("Update global configs"));
    expect(row).toBeGreaterThan(0);

    await harness.mockMouse.click(6, row);
    harness.controller.render();
    await harness.renderOnce();
    expect(harness.controller.state.screen).toBe("plan");
    expect(harness.controller.state.sourceMode).toBe("global");
  });

  it("scrolls a pane with the wheel without changing the cursor", async () => {
    const harness = await createHarness(80, 20);
    await harness.press("RETURN");
    const before = harness.controller.state.cursor;

    await harness.mockMouse.scroll(20, 10, "down");
    await harness.renderOnce();
    expect(harness.controller.state.cursor).toBe(before);

    await harness.press("RETURN");
    expect(harness.controller.state.screen).toBe("presets");
  });
});

describe("TUI text input", () => {
  it("edits the custom source path and pastes clipboard text", async () => {
    const harness = await createHarness(100, 30, { readClipboard: () => "/pasted/path" });
    // Start -> "Use custom source" is the third option.
    await harness.press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
    expect(harness.controller.state.screen).toBe("customSource");

    await harness.mockInput.typeText("./abc", KEY_DELAY_MS);
    harness.controller.render();
    await harness.renderOnce();
    expect(harness.controller.state.textInput).toContain("./abc");

    harness.controller.state.textInput = "";
    harness.controller.render();
    await harness.renderOnce();
    harness.mockInput.pressKey("v", { ctrl: true });
    harness.controller.render();
    await harness.renderOnce();
    expect(harness.controller.state.textInput).toBe("/pasted/path");
  });

  it("loads presets from the submitted custom directory", async () => {
    const requestedRoots: Array<string | undefined> = [];
    const harness = await createHarness(100, 30, {
      listPresets: (options) => {
        requestedRoots.push(options?.customRoot);
        return options?.customRoot
          ? [
              {
                name: "team",
                displayName: "Team",
                description: "",
                source: "custom",
                dir: join(options.customRoot, "team"),
              },
            ]
          : [];
      },
    });

    await harness.controller.handleEffect({ type: "loadCustomPresetSource", path: "C:\\presets" });

    expect(requestedRoots).toContain("C:\\presets");
    expect(harness.controller.state.availablePresets).toContainEqual(
      expect.objectContaining({ name: "team", source: "custom" }),
    );
  });

  it("restores a saved custom preset source and selection when entering the preset-only flow", async () => {
    const filePath = preferencesPath();
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 2,
        scopes: {
          presetsOnly: {
            customPresetSource: "C:\\presets",
            presetSourceMode: "custom",
            selectedPresetNames: ["custom:team", "custom:removed"],
          },
        },
      }),
    );
    const requestedRoots: Array<string | undefined> = [];
    const harness = await createHarness(100, 30, {
      preferencesPath: filePath,
      listPresets: (options) => {
        requestedRoots.push(options?.customRoot);
        return options?.customRoot
          ? [
              {
                name: "team",
                displayName: "Team",
                description: "",
                source: "custom",
                dir: join(options.customRoot, "team"),
              },
            ]
          : [];
      },
    });

    await harness.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");

    expect(requestedRoots).toContain("C:\\presets");
    expect(harness.controller.state.presetSourceMode).toBe("custom");
    expect(harness.controller.state.customPresetSource).toBe("C:\\presets");
    expect(harness.controller.state.selectedPresetNames).toEqual(["custom:team"]);
  });

  it("reports an empty custom preset directory", async () => {
    const harness = await createHarness();
    harness.controller.state.flow = "presetsOnly";
    harness.controller.state.presetSourceMode = "custom";
    harness.controller.state.customPresetSource = "C:\\empty-presets";

    await harness.controller.handleEffect({ type: "loadCustomPresetSource", path: "C:\\empty-presets" });

    expect(harness.controller.state.notice).toContain("No presets found");
    expect(harness.controller.state.notice).toContain("C:\\empty-presets");
  });
});

describe("TUI preference persistence", () => {
  it("leaves future-version preferences untouched for the session", async () => {
    const filePath = preferencesPath();
    const contents = '{\n  "version": 3,\n  "futureField": "preserve me"\n}\n';
    const reminder = "Preferences are newer than this ULIS; changes are not being saved.";
    writeFileSync(filePath, contents);
    const harness = await createHarness(100, 30, { preferencesPath: filePath });

    expect(harness.controller.state.notice).toBe(
      `TUI preferences at ${filePath} use version 3, which is newer than this ULIS understands. Your preferences will not be changed this session.`,
    );

    await harness.press("ARROW_DOWN", "RETURN");

    expect(harness.controller.state.screen).toBe("plan");
    expect(harness.controller.state.notice).toBe(reminder);
    expect(readFileSync(filePath, "utf-8")).toBe(contents);

    harness.controller.state.flow = "presetsOnly";
    await harness.controller.handleEffect({ type: "loadCustomPresetSource", path: "/tmp/presets" });
    expect(harness.controller.state.notice).toBe("No presets found in custom directory: /tmp/presets");
    expect(readFileSync(filePath, "utf-8")).toBe(contents);

    await harness.press("BACKSPACE");
    expect(harness.controller.state.notice).toBe(reminder);
  });
});

describe("TUI workflow runs", () => {
  it("shows the result screen after a successful run", async () => {
    const harness = await createHarness();
    harness.controller.state.sourceMode = "custom";
    harness.controller.state.customSource = join(process.cwd(), "example");

    await harness.controller.handleEffect({ type: "start", action: "validate" });

    expect(harness.controller.state.screen).toBe("result");
    expect(harness.controller.state.resultTitle).toContain("Complete");
    expect(await harness.frame()).toContain("Validate Complete");
  });

  it("shows the failure message and error log when a run throws", async () => {
    const harness = await createHarness();

    // No presets are selected, so the preset validation has nothing to read.
    await harness.controller.handleEffect({ type: "start", action: "presetValidate" });

    expect(harness.controller.state.resultTitle).toContain("Failed");
    expect(harness.controller.state.logs.some((log) => log.startsWith("[error]"))).toBe(true);
    expect(await harness.frame()).toContain("Preset Validate Failed");
  });

  it("aborts a running action and reports it as stopped", async () => {
    let actionSignal: AbortSignal | undefined;
    const harness = await createHarness(100, 30, {
      runAction: async (_state, _action, _logger, options) => {
        const signal = options?.signal;
        if (signal == null) throw new Error("Expected action cancellation signal.");
        actionSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
        });
      },
    });
    const pending = harness.controller.handleEffect({ type: "start", action: "build" });
    await harness.controller.handleEffect({ type: "cancelRunning" });
    await pending;

    expect(actionSignal?.aborted).toBe(true);
    expect(harness.controller.state.screen).toBe("result");
    expect(harness.controller.state.resultTitle).toBe("Build Stopped");
  });

  it("exits non-zero after q stops an install and q quits the result", async () => {
    const harness = await createHarness(100, 30, {
      runAction: async (_state, _action, _logger, options) => {
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
        });
      },
    });
    const stopping = harness.controller.handleEffect({ type: "start", action: "install" });
    await harness.controller.handleEffect(handleTuiKey(harness.controller.state, "q"));
    await stopping;
    expect(harness.controller.state.resultTitle).toBe("Install Stopped");
    await harness.controller.handleEffect(handleTuiKey(harness.controller.state, "q"));

    expect(harness.exitCodes).toEqual([1]);
  });

  it("exits non-zero after a failed install", async () => {
    const harness = await createHarness(100, 30, {
      runAction: async () => {
        throw new Error("install broke");
      },
    });
    await harness.controller.handleEffect({ type: "start", action: "install" });
    expect(harness.controller.state.resultTitle).toBe("Install Failed");
    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(harness.exitCodes).toEqual([1]);
  });

  it("exits zero after a successful run clears an earlier failure", async () => {
    let fail = true;
    const stderr: string[] = [];
    const harness = await createHarness(100, 30, {
      writeStderr: (message) => stderr.push(message),
      runAction: async () => {
        if (fail) throw new Error("first run failed");
      },
    });

    await harness.controller.handleEffect({ type: "start", action: "install" });
    fail = false;
    await harness.controller.handleEffect({ type: "start", action: "install" });
    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(harness.exitCodes).toEqual([0]);
    expect(stderr).toEqual([]);
  });

  it("still exits when the shutdown summary write fails", async () => {
    const harness = await createHarness(100, 30, {
      writeStderr: () => {
        throw new Error("stderr failed");
      },
      runAction: async () => {
        throw new Error("install broke");
      },
    });

    await harness.controller.handleEffect({ type: "start", action: "install" });
    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(harness.exitCodes).toEqual([1]);
  });

  it("routes Ctrl+C from the running app to a non-zero shutdown", async () => {
    let actionSignal: AbortSignal | undefined;
    const harness = await createHarness(100, 30, {
      runAction: async (_state, _action, _logger, options) => {
        const signal = options?.signal;
        if (signal == null) throw new Error("Expected action cancellation signal.");
        actionSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
        });
      },
    });

    const pending = harness.controller.handleEffect({ type: "start", action: "install" });
    harness.mockInput.pressCtrlC();
    await pending;
    await Bun.sleep(0);

    expect(actionSignal?.aborted).toBe(true);
    expect(harness.exitCodes).toEqual([1]);
  });

  it("waits for an interrupted install before exiting non-zero", async () => {
    let actionSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    let releaseRun: (() => void) | undefined;
    const stderr: string[] = [];
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const holdRun = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const harness = await createHarness(100, 30, {
      writeStderr: (message) => stderr.push(message),
      runAction: async (_state, _action, logger, options) => {
        const signal = options?.signal;
        if (signal == null) throw new Error("Expected action cancellation signal.");
        actionSignal = signal;
        logger.info("Install summary — installed: [claude]");
        markStarted?.();
        await holdRun;
      },
    });
    const originalDestroy = harness.renderer.destroy.bind(harness.renderer);
    let destroyCalls = 0;
    harness.renderer.destroy = () => {
      destroyCalls += 1;
      originalDestroy();
    };

    const pending = harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    const shuttingDown = harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(actionSignal?.aborted).toBe(true);
    expect(harness.exitCodes).toEqual([]);
    expect(destroyCalls).toBe(0);
    expect(stderr).toEqual([]);

    releaseRun?.();
    await Promise.all([pending, shuttingDown]);

    expect(destroyCalls).toBe(1);
    expect(harness.exitCodes).toEqual([1]);
    expect(stderr).toEqual(["Install summary — installed: [claude]\n"]);
  });

  it("exits promptly when Ctrl+C is pressed again", async () => {
    let markStarted: (() => void) | undefined;
    let releaseRun: (() => void) | undefined;
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const holdRun = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const harness = await createHarness(100, 30, {
      runAction: async () => {
        markStarted?.();
        await holdRun;
      },
    });
    const originalDestroy = harness.renderer.destroy.bind(harness.renderer);
    let destroyCalls = 0;
    harness.renderer.destroy = () => {
      destroyCalls += 1;
      originalDestroy();
    };

    const running = harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    const firstShutdown = harness.controller.handleEffect({ type: "exit", code: 0 });
    expect(harness.exitCodes).toEqual([]);

    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(destroyCalls).toBe(1);
    expect(harness.exitCodes).toEqual([1]);

    releaseRun?.();
    await Promise.all([running, firstShutdown]);
    expect(destroyCalls).toBe(1);
    expect(harness.exitCodes).toEqual([1]);
  });

  it("bounds the graceful shutdown wait", async () => {
    let markStarted: (() => void) | undefined;
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const harness = await createHarness(100, 30, {
      shutdownGraceMs: 10,
      runAction: async () => {
        markStarted?.();
        await new Promise<void>(() => {});
      },
    });

    void harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(harness.exitCodes).toEqual([1]);
  });

  it("initializes a missing source before resuming the pending action", async () => {
    const calls: string[] = [];
    const resumeOptions: { cwd?: string; signal?: AbortSignal }[] = [];
    const harness = await createHarness(100, 30, {
      cwd: "/tmp/ulis-injected-cwd",
      initializeSource: async () => {
        calls.push("init");
      },
      runAction: async (_state, action, _logger, options) => {
        calls.push(action);
        resumeOptions.push({ cwd: options?.cwd, signal: options?.signal });
      },
    });
    harness.controller.state.pendingAction = "build";

    await harness.controller.handleEffect({ type: "initSource" });

    expect(calls).toEqual(["init", "build"]);
    // Same cwd the plan screen resolved with: without it the resumed action plans against
    // `process.cwd()` and can install somewhere the user was never shown.
    expect(resumeOptions[0]!.cwd).toBe("/tmp/ulis-injected-cwd");
    expect(resumeOptions[0]!.signal).toBeDefined();
    expect(harness.controller.state.pendingAction).toBeUndefined();
    expect(harness.controller.state.resultTitle).toContain("Complete");
  });
});

describe("remote install consent", () => {
  const url = "https://github.com/o/r";

  /** Clone stub that materialises a source tree with a real extensions manifest. */
  function mockClone(): string[] {
    const cloned: string[] = [];
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const dir = args[args.length - 1]!;
        cloned.push(join(dir, ".."));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\nname: remote\n", "utf-8");
        writeFileSync(join(dir, "extensions.yaml"), '"*":\n  extensions:\n    - name: evil-package\n', "utf-8");
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    return cloned;
  }

  afterEach(() => {
    installTest.resetRuntimeDependencies();
  });

  it("disposes the reviewed clone once after an interrupted install settles", async () => {
    const cloned = mockClone();
    let markStarted: (() => void) | undefined;
    let releaseRun: (() => void) | undefined;
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const holdRun = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const harness = await createHarness(100, 30, {
      runAction: async () => {
        markStarted?.();
        await holdRun;
      },
    });
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];
    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    const internals = harness.controller as unknown as {
      preparedRemote: { cleanup: () => void };
    };
    const cleanup = internals.preparedRemote.cleanup;
    let cleanupCalls = 0;
    internals.preparedRemote.cleanup = () => {
      cleanupCalls += 1;
      cleanup();
    };

    const running = harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    const shuttingDown = harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(cleanupCalls).toBe(0);
    expect(cloned.map(existsSync)).toEqual([true]);
    expect(harness.exitCodes).toEqual([]);

    releaseRun?.();
    await Promise.all([running, shuttingDown]);

    expect(cleanupCalls).toBe(1);
    expect(cloned.map(existsSync)).toEqual([false]);
    expect(harness.exitCodes).toEqual([1]);
  });

  it("lists the remote source's real commands on the review screen", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    // Read out of the cloned manifest, not invented by the TUI.
    expect(state.remoteCommands.join(" ")).toContain("evil-package");
    expect(state.remoteCommandSource).toBe(url);
    expect(state.screen).toBe("installReview");
    // The clone is kept for the install that follows, so consent matches what runs.
    expect(cloned.map(existsSync)).toEqual([true]);

    await harness.controller.shutdown(0);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("escapes display controls in the remote source before review", async () => {
    mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = "https://github.com/o/r\u202E\u200B";
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    expect(state.remoteCommandSource).toBe("https://github.com/o/r\\u202e\\u200b");
    const frame = await harness.frame();
    expect(frame).toContain("github.com/o/r\\u202e\\u200b");
    expect(frame).not.toContain("\u202E");
    expect(frame).not.toContain("\u200B");
    await harness.controller.shutdown(0);
  });

  it("clears a remote install review before showing a local review", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    const remoteFrame = await harness.frame();
    const cloneExistsBeforeBack = cloned.map(existsSync);

    await harness.press("BACKSPACE");
    const localSource = mkdtempSync(join(tmpdir(), "ulis-tui-local-source-"));
    tmpRoots.push(localSource);
    writeFileSync(join(localSource, "config.yaml"), "version: 1\n", "utf-8");
    state.customSource = localSource;
    focusInstall(state);
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));

    const localFrame = await harness.frame();
    expect({
      remoteFrameShowsSource: remoteFrame.includes(url),
      remoteFrameShowsWarning: remoteFrame.includes("WILL apply"),
      cloneExistsBeforeBack,
      screen: state.screen,
      cloneExistsAfterBack: cloned.map(existsSync),
      commandsAfterBack: state.remoteCommands,
      commandSourceAfterBack: state.remoteCommandSource,
      localFrameShowsSource: localFrame.includes(localSource),
      localFrameShowsRemote: localFrame.includes(url),
      localFrameShowsWarning: localFrame.includes("WILL apply"),
    }).toEqual({
      remoteFrameShowsSource: true,
      remoteFrameShowsWarning: true,
      cloneExistsBeforeBack: [true],
      screen: "installReview",
      cloneExistsAfterBack: [false],
      commandsAfterBack: [],
      commandSourceAfterBack: "",
      localFrameShowsSource: true,
      localFrameShowsRemote: false,
      localFrameShowsWarning: false,
    });
  });

  it("keeps the prepared clone while a remote install handles a stray key", async () => {
    const cloned = mockClone();
    let releaseRun: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const holdRun = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let receivedPrepared = false;
    const harness = await createHarness(100, 30, {
      runAction: (async (_state: TuiState, _action: string, _logger: unknown, options: { prepared?: unknown }) => {
        receivedPrepared = options?.prepared != null;
        markStarted?.();
        await holdRun;
      }) as never,
    });
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    const running = harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    const strayEffect = handleTuiKey(state, "down");
    await harness.controller.handleEffect(strayEffect);
    const cloneExistsDuringRun = cloned.map(existsSync);
    releaseRun?.();
    await running;
    const cloneExistsAfterRun = cloned.map(existsSync);

    expect({ strayEffect, receivedPrepared, cloneExistsDuringRun, cloneExistsAfterRun }).toEqual({
      strayEffect: { type: "none" },
      receivedPrepared: true,
      cloneExistsDuringRun: [true],
      cloneExistsAfterRun: [false],
    });
  });

  it("clears a remote preset review on its Back row and re-prepares it when reopened", async () => {
    const cloned = mockClone();
    const runCalls: { prepared: unknown }[] = [];
    const harness = await createHarness(100, 30, {
      runAction: ((_state: TuiState, _action: string, _logger: unknown, opts: { prepared?: unknown }) => {
        runCalls.push({ prepared: opts.prepared });
        return Promise.resolve();
      }) as never,
    });
    const state = harness.controller.state;
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "presetInstall" });
    expect(cloned.map(existsSync)).toEqual([true]);

    state.cursor = PRESET_INSTALL_REVIEW_START_ROW + 1;
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));
    expect(cloned.map(existsSync)).toEqual([false]);
    expect(state.remoteCommands).toEqual([]);
    expect(state.remoteCommandSource).toBe("");

    focusInstall(state);
    await Bun.sleep(KEY_DELAY_MS);
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));
    expect(state.screen).toBe("presetInstallReview");
    expect(cloned).toHaveLength(2);
    expect(cloned.map(existsSync)).toEqual([false, true]);

    state.cursor = PRESET_INSTALL_REVIEW_START_ROW;
    await Bun.sleep(KEY_DELAY_MS);
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));
    expect(runCalls[0]!.prepared).toBeDefined();
    expect(cloned.map(existsSync)).toEqual([false, false]);
  });

  it("clears a prepared remote review when flow defaults are applied", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    expect(cloned.map(existsSync)).toEqual([true]);

    state.screen = "flow";
    state.cursor = 0;
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));

    expect(state.flow).toBe("project");
    expect(cloned.map(existsSync)).toEqual([false]);
    expect(state.remoteCommands).toEqual([]);
    expect(state.remoteCommandSource).toBe("");
  });

  it("disposes the previous clone when preparation runs again", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    // Options change the command list, not the tree it is read from: no second fetch.
    state.platforms = ["claude", "cursor"];
    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    expect(cloned).toHaveLength(1);

    // A different remote is a different tree, and reviewing it must not strand the first clone.
    state.customSource = "https://github.com/o/other";
    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    expect(cloned).toHaveLength(2);
    expect(existsSync(cloned[0]!)).toBe(false);
    expect(existsSync(cloned[1]!)).toBe(true);

    await harness.controller.shutdown(0);
    expect(cloned.map(existsSync)).toEqual([false, false]);
  });

  it("keeps only the newest clone when two preparations overlap", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    // Overlapping preparations: the superseded one must throw its own clone away.
    await Promise.all([
      harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" }),
      harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" }),
    ]);

    expect(cloned.filter(existsSync)).toHaveLength(1);
    await harness.controller.shutdown(0);
    expect(cloned.filter(existsSync)).toHaveLength(0);
  });

  it("waits for a superseded preparation before exiting", async () => {
    const cloned: string[] = [];
    let release: (() => void) | undefined;
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const dir = args[args.length - 1]!;
        cloned.push(join(dir, ".."));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\n", "utf-8");
        // Only the first (soon superseded) clone hangs; the second finishes straight away.
        if (cloned.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    const preparingFirst = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Bun.sleep(10);
    state.platforms = ["claude", "cursor"];
    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    // Shutdown must await the first preparation too, not just the newest one.
    const shutting = harness.controller.shutdown(0);
    setTimeout(() => release?.(), 5);
    await shutting;

    expect(cloned).toHaveLength(2);
    expect(cloned.filter(existsSync)).toHaveLength(0);
    await preparingFirst;
  });

  it("binds the review to the settings it was generated for", async () => {
    const cloned = mockClone();
    const runCalls: { prepared: unknown }[] = [];
    const harness = await createHarness(100, 30, {
      runAction: ((_state: TuiState, _action: string, _logger: unknown, opts: { prepared?: unknown }) => {
        runCalls.push({ prepared: opts.prepared });
        return Promise.resolve();
      }) as never,
    });
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    expect(reviewFingerprint(state, "install")).toBe(reviewFingerprint(state, "install"));

    // A setting the review was generated for changes without going back through the review screen.
    state.skipExternalSkills = !state.skipExternalSkills;
    await harness.controller.handleEffect({ type: "start", action: "install" });

    // The controller must not hand the stale review to the run, and must drop its clone.
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]!.prepared).toBeUndefined();
    expect(cloned.map(existsSync)).toEqual([false]);
    await harness.controller.shutdown(0);
  });

  it("does not hand a remote review to a later local start", async () => {
    const cloned = mockClone();
    const runCalls: { sourceDir: string; prepared: unknown }[] = [];
    const harness = await createHarness(100, 30, {
      runAction: ((
        state: { customSource: string },
        _action: string,
        _logger: unknown,
        opts: { prepared?: unknown },
      ) => {
        runCalls.push({ sourceDir: state.customSource, prepared: opts.prepared });
        return Promise.resolve();
      }) as never,
    });
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    expect(cloned.map(existsSync)).toEqual([true]);

    // Back out of the review and switch to a purely local source.
    state.sourceMode = "project";
    state.customSource = "";
    await harness.controller.handleEffect({ type: "start", action: "install" });

    // The stale remote clone must neither be passed along nor left on disk.
    expect(runCalls[0]!.prepared).toBeUndefined();
    expect(cloned.map(existsSync)).toEqual([false]);
    await harness.controller.shutdown(0);
  });

  it("plans from a snapshot taken with the fingerprint, not from live state", async () => {
    const harness = await createHarness();
    const state = harness.controller.state;
    // Toggled off mid-clone and back on afterwards: the review must reflect the settings it was
    // fingerprinted for, not the value that happened to be live when planning ran.
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        state.skipExternalSkills = true;
        const dir = args[args.length - 1]!;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\nname: remote\n", "utf-8");
        writeFileSync(join(dir, "extensions.yaml"), '"*":\n  extensions:\n    - name: evil-package\n', "utf-8");
        // The skills command is the one `skipExternalSkills` gates, so it is what proves the plan
        // came from the snapshot rather than from the value live when planning ran.
        writeFileSync(join(dir, "skills.yaml"), '"*":\n  skills:\n    - name: test/skill\n', "utf-8");
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];
    state.skipExternalSkills = false;

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    state.skipExternalSkills = false;

    expect(state.remoteCommands.join(" ")).toContain("evil-package");
    // Planned with skills enabled, as fingerprinted - not with the value set during the clone.
    expect(state.remoteCommands.join(" ")).toContain("test/skill");
    await harness.controller.shutdown(0);
  });

  it("waits unbounded for an in-flight clone before exiting", async () => {
    const cloned: string[] = [];
    let release: (() => void) | undefined;
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const dir = args[args.length - 1]!;
        cloned.push(join(dir, ".."));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\n", "utf-8");
        // Hold the clone open so shutdown lands while it is still in flight.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    const harness = await createHarness(100, 30, { shutdownGraceMs: 10 });
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    const preparing = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Bun.sleep(10);
    const shutting = harness.controller.shutdown(0);
    await Bun.sleep(20);
    await harness.controller.shutdown(0);

    expect(harness.exitCodes).toEqual([]);
    expect(cloned.map(existsSync)).toEqual([true]);

    release?.();
    await Promise.all([preparing, shutting]);

    expect(cloned).toHaveLength(1);
    expect(cloned.map(existsSync)).toEqual([false]);
    expect(harness.exitCodes).toEqual([1]);
  });

  /** Puts the plan screen's cursor on Install, so a real `enter` starts the remote flow. */
  function focusInstall(state: TuiState): void {
    state.screen = "plan";
    state.cursor = planItems(state).findIndex((item) => item.id === "install");
  }

  it("keeps the remote preset review valid when its own toggles are used", async () => {
    const cloned = mockClone();
    const runCalls: { prepared: unknown }[] = [];
    const harness = await createHarness(100, 30, {
      runAction: ((_state: TuiState, _action: string, _logger: unknown, opts: { prepared?: unknown }) => {
        runCalls.push({ prepared: opts.prepared });
        return Promise.resolve();
      }) as never,
    });
    const state = harness.controller.state;
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = url;
    state.platforms = ["claude"];
    focusInstall(state);

    // Real keys through the real handler, the way the screen is actually used.
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));
    expect(state.screen).toBe("presetInstallReview");
    // Land on "Start preset install", never on a toggle a confirming Enter would flip instead.
    expect(state.cursor).toBe(PRESET_INSTALL_REVIEW_START_ROW);

    // Every toggle on this screen is part of the review fingerprint.
    state.cursor = 0;
    await harness.controller.handleEffect(handleTuiKey(state, "x"));
    expect(state.backup).toBe(false);
    expect(state.screen).toBe("presetInstallReview");
    // Regenerated from the clone already on disk: using the screen must not re-fetch the remote.
    expect(cloned).toHaveLength(1);

    state.cursor = PRESET_INSTALL_REVIEW_START_ROW;
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));

    // The review the user just used is still the one that runs.
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]!.prepared).toBeDefined();
    expect(state.resultTitle).toContain("Complete");
    await harness.controller.shutdown(0);
  });

  it("shows the fetch on the running screen and ignores plan edits while it runs", async () => {
    let release: (() => void) | undefined;
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const dir = args[args.length - 1]!;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\n", "utf-8");
        // Hold the clone open so the assertions land while it is still in flight.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];
    focusInstall(state);

    const preparing = harness.controller.handleEffect(handleTuiKey(state, "enter"));
    await Bun.sleep(10);

    // Announced, not silent: the same running screen every other long operation uses.
    expect(state.screen).toBe("running");
    expect(await harness.frame()).toContain("Fetch remote source");

    // And inert: a keypress that would edit the plan cannot invalidate the review being prepared.
    handleTuiKey(state, "x");
    expect(state.backup).toBe(true);

    // `q` cancels the fetch rather than quitting the whole TUI.
    await harness.controller.handleEffect(handleTuiKey(state, "q"));
    expect(harness.exitCodes).toEqual([]);

    release?.();
    await preparing;
    expect(state.screen).toBe("plan");
    expect(state.notice).toContain("stopped by user");

    await harness.controller.shutdown(0);
  });

  it("surfaces a failed clone as a notice instead of crashing", async () => {
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand() {
        return { status: 1, stdout: "", stderr: "fatal: repository not found" };
      },
    } as never);
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    expect(state.notice).toContain("Failed to clone");
    expect(state.remoteCommands).toEqual([]);
    expect(state.screen).not.toBe("installReview");
  });
});
