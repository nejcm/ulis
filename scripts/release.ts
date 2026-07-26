import { spawn } from "node:child_process";

import { Bumper } from "conventional-recommended-bump";

type ParsedCommit = {
  readonly notes: readonly unknown[];
  readonly type?: string;
};

function recommendBump(commits: ParsedCommit[]): { level: number; reason: string } | undefined {
  let level: number | undefined;
  let breakings = 0;
  let features = 0;

  for (const commit of commits) {
    if (commit.notes.length > 0) {
      breakings += commit.notes.length;
      level = 0;
      continue;
    }

    if (commit.type === "feat" || commit.type === "feature") {
      features++;
      level = Math.min(level ?? 2, 1);
    } else if (["fix", "perf", "revert", "chore", "refactor"].includes(commit.type ?? "")) {
      level ??= 2;
    }
  }

  if (level === undefined) return undefined;

  const breakingLabel = breakings === 1 ? "BREAKING CHANGE" : "BREAKING CHANGES";
  return {
    level,
    reason: `There are ${breakings} ${breakingLabel} and ${features} features`,
  };
}

const recommendation = await new Bumper().loadPreset("conventionalcommits").bump(recommendBump);

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
