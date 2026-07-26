import { spawn } from "node:child_process";

import { Bumper } from "conventional-recommended-bump";

const recommendation = await new Bumper().loadPreset("conventionalcommits").bump();

if (!recommendation.releaseType) {
  console.log("No release-worthy Conventional Commits found; skipping publish.");
} else {
  const npCommand = process.platform === "win32" ? "np.cmd" : "np";
  const np = spawn(
    npCommand,
    [recommendation.releaseType, "--message", "chore(release): %s", "--no-tests", "--no-release-draft"],
    {
      stdio: "inherit",
    },
  );

  const exitCode = await new Promise<number>((resolve, reject) => {
    np.once("error", reject);
    np.once("close", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });

  process.exitCode = exitCode;
}
