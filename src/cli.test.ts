import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const cliPath = join(repoRoot, "src", "cli.ts");
const packageVersion = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string })
  .version;

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Copy `example/` into a temp dir so a build that does reach the generator cannot write into the
 * repository - the point of the --target tests is that it never gets that far.
 */
function createExampleSource(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-cli-"));
  tmpRoots.push(root);
  const source = join(root, "example");
  cpSync(join(repoRoot, "example"), source, { recursive: true });
  return source;
}

/** Spawn the real CLI the same way `cli-prune.test.ts` does: the test runtime executing `src/cli.ts`. */
function runCli(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("CLI command dispatch", () => {
  it("exits non-zero with a stderr message for an unknown command", () => {
    const result = runCli(["frobnicate"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown command: "frobnicate"');
    expect(result.stderr).toContain("ulis --help");
    // The help text must not be printed on success streams for a failed invocation.
    expect(result.stdout).toBe("");
  });

  it("prints help and exits 0 when invoked with no arguments", () => {
    const result = runCli([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ulis/");
    expect(result.stdout).toContain("Commands:");
    expect(result.stderr).toBe("");
  });
});

describe("CLI help and version flags", () => {
  it("prints only the version line for --version", () => {
    const result = runCli(["--version"]);

    expect(result.status).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(`ulis/${packageVersion} `);
    expect(result.stdout).not.toContain("Commands:");
  });

  it("prints help exactly once for --help", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout.split("Commands:")).toHaveLength(2);
    expect(result.stderr).toBe("");
  });
});

describe("CLI --target coercion", () => {
  it("rejects a bare --target", () => {
    // cac catches the missing value itself; the assertion pins that it never reaches platform parsing.
    const result = runCli(["build", "--target"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("value is missing");
    expect(result.stderr).not.toContain("value.split is not a function");
  });

  it("rejects an empty --target", () => {
    const result = runCli(["build", "--source", createExampleSource(), "--target", ""]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid --target");
  });

  it("rejects a comma-only --target instead of silently building nothing", () => {
    const result = runCli(["build", "--source", createExampleSource(), "--target", ","]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid --target");
  });

  it("still rejects an unknown platform name", () => {
    const result = runCli(["build", "--source", createExampleSource(), "--target", "nope"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown platform(s): nope");
  });
});
