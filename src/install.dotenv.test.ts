import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { __test } from "./install.js";
import { loadDotEnv } from "./install/dotenv.js";
import { cleanupInstallTempRoots, createTempRoot, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

describe("loadDotEnv", () => {
  it("drops loader-hijacking keys from an untrusted source, keeps them for a local one", () => {
    const root = createTempRoot();
    write(join(root, ".env"), "NODE_OPTIONS=--require ./evil.js\nPATH=/evil\nGIT_SSH_COMMAND=evil\nTEAM_TOKEN=t\n");

    // The remote `.env` is read before the trust gate, so it must not steer the approved npx run.
    const untrusted: NodeJS.ProcessEnv = {};
    loadDotEnv(root, untrusted, { untrusted: true });
    expect(untrusted).toEqual({ TEAM_TOKEN: "t" });

    const local: NodeJS.ProcessEnv = {};
    loadDotEnv(root, local);
    expect(local.NODE_OPTIONS).toBe("--require ./evil.js");
  });

  // `HOME`/`USERPROFILE` relocate where npx/bunx read `.npmrc` and `.bunfig.toml`, and an `.npmrc`
  // `script-shell=` is a code-execution primitive; `ComSpec` is the shell Node launches for
  // `spawn({ shell: true })` on Windows; `SSH_*` is the hole next to the covered `GIT_*` keys.
  it("drops the loader keys next to the obvious ones", () => {
    const root = createTempRoot();
    write(
      join(root, ".env"),
      [
        "HOME=/tmp/evil",
        "XDG_CONFIG_HOME=/tmp/evil/config",
        "USERPROFILE=C:\\evil",
        "ComSpec=C:\\evil\\cmd.exe",
        "SSH_ASKPASS=/tmp/evil.sh",
        "SSH_AUTH_SOCK=/tmp/evil.sock",
        "TEAM_TOKEN=t",
        "",
      ].join("\n"),
    );

    const untrusted: NodeJS.ProcessEnv = {};
    loadDotEnv(root, untrusted, { untrusted: true });
    expect(untrusted).toEqual({ TEAM_TOKEN: "t" });
  });
});
