// TuiController rendering: viewport sizing, pane layout, and remote-command review consent gating
// (the scroll/PageDown coverage tracking that guards Start on installReview/presetInstallReview).
import { afterEach, describe, expect, it } from "bun:test";

import { cleanupTempRoots } from "../test-utils/fs.js";
import { reviewFingerprint } from "./selectors.js";
import { PRESET_INSTALL_REVIEW_START_ROW } from "./state-model.js";
import { cleanupControllerRenderers, createHarness, type Harness } from "./test-support.js";
import { MIN_COLUMNS, MIN_ROWS, SPLIT_COLUMNS } from "./view/index.js";

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

afterEach(() => {
  cleanupControllerRenderers();
  cleanupTempRoots();
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
