/**
 * Wrapper around `npx skills@latest add` that installs skills into
 * .ai/global/skills/ instead of the default .<agent>/skills/ path.
 *
 * Usage:
 *   bun scripts/install-skill.js <package> [--skill <name>] [--yes]
 *
 * Examples:
 *   bun scripts/install-skill.js vercel-labs/agent-skills
 *   bun scripts/install-skill.js vercel-labs/agent-skills --skill deploy-to-vercel
 *   bun scripts/install-skill.js https://github.com/org/skills-repo --yes
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "fs";
import { join } from "path";

const SKILLS_DIR = ".ai/global/skills";

// Skills CLI installs "universal" agent skills to .agents/skills/
const STAGING_AGENT = "universal";
const STAGING_DIR = ".agents/skills";

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(
    "Usage: bun scripts/install-skill.js <package> [--skill <name>] [--yes]",
  );
  console.log("");
  console.log("Examples:");
  console.log(
    "  bun scripts/install-skill.js vercel-labs/agent-skills",
  );
  console.log(
    "  bun scripts/install-skill.js vercel-labs/agent-skills --skill deploy-to-vercel",
  );
  process.exit(0);
}

const packageArg = args[0];
const remainingArgs = args.slice(1);

// Always add --copy so we get actual files, not symlinks
const extraFlags = ["--agent", STAGING_AGENT, "--copy"];

// Pass through --skill, --yes flags from user
for (let i = 0; i < remainingArgs.length; i++) {
  const flag = remainingArgs[i];
  if (flag === "--skill" || flag === "-s") {
    extraFlags.push("--skill", remainingArgs[++i]);
  } else if (flag === "--yes" || flag === "-y") {
    extraFlags.push("--yes");
  }
}

try {
  const cmd = `npx skills@latest add ${packageArg} ${extraFlags.join(" ")}`;
  console.log(`Running: ${cmd}\n`);
  execSync(cmd, { stdio: "inherit" });

  if (!existsSync(STAGING_DIR)) {
    console.error(`\nNo skills installed — staging dir not found: ${STAGING_DIR}`);
    process.exit(1);
  }

  const installed = readdirSync(STAGING_DIR);
  if (installed.length === 0) {
    console.log("\nNo skills to move.");
    process.exit(0);
  }

  mkdirSync(SKILLS_DIR, { recursive: true });

  for (const skill of installed) {
    const src = join(STAGING_DIR, skill);
    const dest = join(SKILLS_DIR, skill);

    if (existsSync(dest)) {
      console.log(`\nUpdating: ${skill}`);
      rmSync(dest, { recursive: true });
    } else {
      console.log(`\nInstalling: ${skill}`);
    }

    renameSync(src, dest);
    console.log(`  → ${dest}`);
  }

  console.log(`\nDone. Run 'bun run build' to include new skills in generated configs.`);
} finally {
  // Clean up the staging agent directory entirely
  rmSync(".agents", { recursive: true, force: true });
}
