import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const cliPath = join(repoRoot, "src", "cli.ts");
const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CLI pruning flags", () => {
  it("wires default pruning and --no-prune ownership relinquishment through ulis install", () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const generatedAgent = join(sourceDir, "generated", "claude", "agents", "worker.md");
    write(generatedAgent, "Generated worker.\n");

    runCli(root, ["install", "--source", sourceDir, "--target", "claude", "--yes", "--skip-rebuild"]);
    rmSync(generatedAgent);
    runCli(root, ["install", "--source", sourceDir, "--target", "claude", "--yes", "--skip-rebuild"]);
    expect(existsSync(join(root, ".claude", "agents", "worker.md"))).toBe(false);

    write(generatedAgent, "Generated worker.\n");
    runCli(root, ["install", "--source", sourceDir, "--target", "claude", "--yes", "--skip-rebuild"]);
    rmSync(generatedAgent);
    runCli(root, ["install", "--source", sourceDir, "--target", "claude", "--yes", "--skip-rebuild", "--no-prune"]);
    runCli(root, ["install", "--source", sourceDir, "--target", "claude", "--yes", "--skip-rebuild"]);
    expect(existsSync(join(root, ".claude", "agents", "worker.md"))).toBe(true);
  });

  it("wires default pruning and --no-prune ownership relinquishment through preset install", () => {
    const root = createTempRoot();
    const userHome = join(root, "home");
    const presetsRoot = join(userHome, ".ulis", "presets");
    const populatedPreset = join(presetsRoot, "populated");
    const emptyPreset = join(presetsRoot, "empty");
    write(join(populatedPreset, "config.yaml"), "version: 1\nname: populated\n");
    write(
      join(populatedPreset, "agents", "worker.md"),
      "---\ndescription: Worker\nmodel: claude-haiku-4-5-20251001\ntools:\n  read: true\n---\n\nWorker.\n",
    );
    write(join(emptyPreset, "config.yaml"), "version: 1\nname: empty\n");

    runCli(root, ["preset", "install", "populated", "--target", "claude", "--yes"], userHome);
    runCli(root, ["preset", "install", "empty", "--target", "claude", "--yes"], userHome);
    expect(existsSync(join(root, ".claude", "agents", "worker.md"))).toBe(false);

    runCli(root, ["preset", "install", "populated", "--target", "claude", "--yes"], userHome);
    runCli(root, ["preset", "install", "empty", "--target", "claude", "--yes", "--no-prune"], userHome);
    runCli(root, ["preset", "install", "empty", "--target", "claude", "--yes"], userHome);
    expect(existsSync(join(root, ".claude", "agents", "worker.md"))).toBe(true);
  });
});

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-cli-prune-"));
  tmpRoots.push(root);
  return root;
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function runCli(cwd: string, args: readonly string[], userHome?: string): void {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: userHome ? { ...process.env, HOME: userHome, USERPROFILE: userHome } : process.env,
  });
  if (result.status !== 0) {
    throw new Error(`CLI failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
}
