/**
 * Runs `ulis install` against a throwaway copy of `example/` in the OS temp directory.
 *
 * `install` resolves its destination to the *parent* of `--source` (`src/utils/resolve-source.ts`),
 * so `--source example` would target the repo root — which already holds `.claude/`, `.codex/` and
 * `.cursor/`. Install runs with prune on and no backup, so that would overwrite real config.
 * Copying the example into a temp directory first keeps the blast radius inside that directory.
 *
 * Usage: bun run dev:install [-- extra ulis install flags]
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(join(import.meta.dirname, "../.."));
const destBase = mkdtempSync(join(tmpdir(), "ulis-dev-install-"));
const sourceDir = join(destBase, "example");

cpSync(join(repoRoot, "example"), sourceDir, { recursive: true });

console.log(`dev:install → ${destBase}`);

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    join(repoRoot, "src", "cli.ts"),
    "install",
    "--yes",
    "--source",
    sourceDir,
    ...process.argv.slice(2),
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

console.log(`\ndev:install wrote to ${destBase} — inspect it there, then delete it.`);
process.exit(result.status ?? 1);
