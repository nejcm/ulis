import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Logger } from "../build.js";
import { __test } from "../install.js";
import { redactUserinfo } from "./redact.js";
import { fetchRemoteSource, isRemoteSource, parseRepoUrl } from "./remote-source.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("isRemoteSource", () => {
  it("accepts https, ssh and scp-like remotes", () => {
    expect(isRemoteSource("https://github.com/o/r")).toBe(true);
    expect(isRemoteSource("ssh://git@github.com/o/r")).toBe(true);
    expect(isRemoteSource("git@github.com:o/r.git")).toBe(true);
  });

  it("rejects local paths, including Windows drive letters", () => {
    expect(isRemoteSource("C:\\presets")).toBe(false);
    expect(isRemoteSource("/home/x/presets")).toBe(false);
    expect(isRemoteSource("./rel")).toBe(false);
    expect(isRemoteSource("team")).toBe(false);
  });
});

describe("parseRepoUrl", () => {
  it("passes a plain repo URL through", () => {
    expect(parseRepoUrl("https://github.com/o/r")).toEqual({ cloneUrl: "https://github.com/o/r" });
  });

  it("reads the ref out of a GitHub tree URL", () => {
    expect(parseRepoUrl("https://github.com/o/r/tree/main")).toEqual({
      cloneUrl: "https://github.com/o/r",
      ref: "main",
      subdir: undefined,
    });
  });

  it("reads ref and subdir out of a GitHub tree URL", () => {
    expect(parseRepoUrl("https://github.com/o/r/tree/main/presets/team")).toEqual({
      cloneUrl: "https://github.com/o/r",
      ref: "main",
      subdir: "presets/team",
    });
  });

  it("reads ref and subdir out of a GitLab tree URL", () => {
    expect(parseRepoUrl("https://gitlab.com/o/r/-/tree/main/presets/team")).toEqual({
      cloneUrl: "https://gitlab.com/o/r",
      ref: "main",
      subdir: "presets/team",
    });
  });

  it("keeps every GitLab subgroup segment in the clone URL", () => {
    expect(parseRepoUrl("https://gitlab.com/group/subgroup/r/-/tree/main/presets/team")).toEqual({
      cloneUrl: "https://gitlab.com/group/subgroup/r",
      ref: "main",
      subdir: "presets/team",
    });
  });

  it("keeps a namespace segment literally named tree", () => {
    expect(parseRepoUrl("https://gitlab.com/group/tree/repo/-/tree/main")).toEqual({
      cloneUrl: "https://gitlab.com/group/tree/repo",
      ref: "main",
      subdir: undefined,
    });
  });

  it("keeps URL credentials in the clone URL of a tree URL", () => {
    expect(parseRepoUrl("https://user:token@github.com/o/r/tree/main")).toEqual({
      cloneUrl: "https://user:token@github.com/o/r",
      ref: "main",
      subdir: undefined,
    });
  });

  it("rejects a subdir that escapes the repository once decoded", () => {
    expect(() => parseRepoUrl("https://github.com/o/r/tree/main/..%2F..")).toThrow(/stay inside the repository/u);
    expect(() => parseRepoUrl("https://github.com/o/r/tree/main/%2Fetc%2Fpasswd")).toThrow(
      /stay inside the repository/u,
    );
    // Unescaped (and dot-escaped) `..` never reaches us: the URL parser collapses it first.
    expect(parseRepoUrl("https://github.com/o/r/tree/main/presets/..").subdir).toBeUndefined();
    expect(() => parseRepoUrl("https://github.com/o/r/tree/main/C%3A%5Cwindows")).toThrow(
      /stay inside the repository/u,
    );
  });

  // The raw-URL guard runs before decoding, so `%00` walks straight past it. A NUL in the subdir
  // reaches `join`/`statSync` and throws a TypeError instead of this message; one in the ref reaches
  // `git clone --branch` argv.
  it("rejects control characters that only appear after percent-decoding", () => {
    const NUL = "%00";
    expect(() => parseRepoUrl(`https://github.com/o/r/tree/main/a${NUL}b`)).toThrow(/control characters/u);
    expect(() => parseRepoUrl(`https://github.com/o/r/tree/ma${NUL}in/x`)).toThrow(/control characters/u);
    // The message must not carry the control character it is refusing.
    const message = (() => {
      try {
        parseRepoUrl(`https://github.com/o/r/tree/main/a${NUL}b`);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).not.toContain(String.fromCharCode(0));
  });

  it("decodes percent-escaped ref and subdir segments", () => {
    expect(parseRepoUrl("https://github.com/o/r/tree/rel%2Bv1/presets/My%20Team")).toEqual({
      cloneUrl: "https://github.com/o/r",
      ref: "rel+v1",
      subdir: "presets/My Team",
    });
  });

  it("strips a ref fragment from any host", () => {
    expect(parseRepoUrl("https://git.corp/x/y.git#v1.2.3")).toEqual({
      cloneUrl: "https://git.corp/x/y.git",
      ref: "v1.2.3",
    });
  });

  it("takes the fragment ref off a web URL instead of cloning its /tree/ path", () => {
    expect(parseRepoUrl("https://github.com/o/r/tree/main/presets/team#feat/slashed")).toEqual({
      cloneUrl: "https://github.com/o/r",
      ref: "feat/slashed",
      subdir: "presets/team",
    });
  });

  it("passes scp-like remotes through untouched", () => {
    expect(parseRepoUrl("git@github.com:o/r.git")).toEqual({ cloneUrl: "git@github.com:o/r.git" });
  });

  it("does not pre-validate non-repo URLs", () => {
    expect(parseRepoUrl("https://example.com/thing.zip")).toEqual({ cloneUrl: "https://example.com/thing.zip" });
  });

  it("rejects http and git protocols", () => {
    expect(() => parseRepoUrl("http://github.com/o/r")).toThrow(/HTTPS or SSH/u);
    expect(() => parseRepoUrl("git://github.com/o/r")).toThrow(/HTTPS or SSH/u);
  });

  it("rejects a commit SHA ref", () => {
    expect(() => parseRepoUrl(`https://github.com/o/r/tree/${SHA}`)).toThrow(/branch or a tag/u);
    expect(() => parseRepoUrl(`https://git.corp/x/y.git#${SHA}`)).toThrow(/branch or a tag/u);
  });

  it("rejects authorities no redactor can strip, without echoing them", () => {
    for (const url of [
      "https://user:TOP, SECRET@github.com/o/r",
      "https:///user:TOP,SECRET@github.com/o/r",
      "https://user:TOP/SECRET@github.com/o/r",
      "http://user:TOP/SECRET@github.com/o/r",
      "https://user:TOP/\tSECRET@github.com/o/r",
      "https://user:TOP\u0000SECRET@github.com/o/r",
    ]) {
      const message = String(expectThrow(() => parseRepoUrl(url)));
      expect(message).not.toContain("TOP");
      expect(message).not.toContain("SECRET");
      expect(message).toMatch(/may contain a password/u);
    }
  });

  it("keeps the credential out of the HTTP-rejection message", () => {
    const message = String(expectThrow(() => parseRepoUrl("http://user:SECRET@github.com/o/r")));
    expect(message).not.toContain("SECRET");
    expect(message).toContain("http://github.com/o/r");
  });
});

function expectThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : error;
  }
  throw new Error("expected a throw");
}

describe("redactUserinfo", () => {
  it("strips credentials whatever the password contains", () => {
    expect(redactUserinfo("https://user:pw@github.com/o/r")).toBe("https://github.com/o/r");
    expect(redactUserinfo("https://user:p@ss@github.com/o/r")).toBe("https://github.com/o/r");
    expect(redactUserinfo("https://user:TOP, SECRET@github.com/o/r")).toBe("https://github.com/o/r");
    expect(redactUserinfo("https:///user:TOP,SECRET@github.com/o/r")).toBe("https://github.com/o/r");
  });

  it("strips the credential git echoes back in its stderr", () => {
    const stderr = "fatal: unable to access 'https://user:TOP, SECRET@github.com/o/r/': 403";
    expect(redactUserinfo(stderr)).toBe("fatal: unable to access 'https://github.com/o/r/': 403");
  });

  it("does not touch an @ outside the authority", () => {
    // Over-redacting here would let a preview show a trusted host for a different argument.
    expect(redactUserinfo("https://evil.example?note=user@trusted.example")).toBe(
      "https://evil.example?note=user@trusted.example",
    );
    expect(redactUserinfo("https://evil.example#user@trusted.example")).toBe(
      "https://evil.example#user@trusted.example",
    );
  });

  it("leaves credential-free text alone", () => {
    expect(redactUserinfo("https://github.com/o/r")).toBe("https://github.com/o/r");
    expect(redactUserinfo("cloning into repo")).toBe("cloning into repo");
  });

  it("over-redacts rather than leaks when an unrelated @ trails a URL", () => {
    // Known shape: greedy to the last `@` before the path, so a mangled message is the price of
    // never leaving half a password behind.
    expect(redactUserinfo("see https://github.com a@b for help")).toBe("see https://b for help");
  });
});

// --- real git, file:// remotes ---------------------------------------------

let fixtureRoot: string;
let basicRepo: string;

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "ulis-remote-fixture-"));
  basicRepo = join(fixtureRoot, "basic");
  mkdirSync(basicRepo, { recursive: true });
  git(basicRepo, "init", "-q", "-b", "main", ".");
  write(join(basicRepo, "a.txt"), "one");
  git(basicRepo, "add", "-A");
  git(basicRepo, "commit", "-qm", "one");
  git(basicRepo, "tag", "v1");
  write(join(basicRepo, "a.txt"), "two");
  git(basicRepo, "add", "-A");
  git(basicRepo, "commit", "-qm", "two");
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

afterEach(() => {
  __test.resetRuntimeDependencies();
});

describe("fetchRemoteSource (real git)", () => {
  it("clones the default branch", async () => {
    const remote = await fetchRemoteSource(pathToFileURL(basicRepo).href);
    try {
      expect(await Bun.file(join(remote.dir, "a.txt")).text()).toBe("two");
      expect(existsSync(join(remote.dir, ".git"))).toBe(true);
      expect(remote.name).toBe("basic");
    } finally {
      remote.cleanup();
    }
  });

  it("clones a tag when the URL carries a ref", async () => {
    const remote = await fetchRemoteSource(`${pathToFileURL(basicRepo).href}#v1`);
    try {
      expect(await Bun.file(join(remote.dir, "a.txt")).text()).toBe("one");
    } finally {
      remote.cleanup();
    }
  });

  it("cleans up idempotently", async () => {
    const remote = await fetchRemoteSource(pathToFileURL(basicRepo).href);
    const tempRoot = dirname(remote.dir);
    remote.cleanup();
    remote.cleanup();
    expect(existsSync(tempRoot)).toBe(false);
  });

  it("throws with the git stderr tail for a nonexistent remote", async () => {
    const missing = pathToFileURL(join(fixtureRoot, "nope")).href;
    await expect(fetchRemoteSource(missing)).rejects.toThrow(/Failed to clone .*nope/u);
  });

  it("removes the temp directory when the clone fails", async () => {
    const before = tempRemoteDirs();
    await fetchRemoteSource(pathToFileURL(join(fixtureRoot, "nope")).href).catch(() => undefined);
    expect(tempRemoteDirs()).toEqual(before);
  });
});

function tempRemoteDirs(): readonly string[] {
  return [...new Bun.Glob("ulis-remote-*").scanSync({ cwd: tmpdir(), onlyFiles: false })].sort();
}

// --- mocked spawn ----------------------------------------------------------

interface CloneCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Stub the clone so argv, env and the post-clone walk can be asserted without a network or a repo.
 * `build` populates the clone target directory.
 */
function mockClone(options: {
  build?: (dir: string) => void;
  status?: number;
  stderr?: string;
  hasGh?: boolean;
  /** Runs inside the stubbed clone - use it to abort mid-flight. */
  onCall?: () => void;
}): readonly CloneCall[] {
  const calls: CloneCall[] = [];
  __test.setRuntimeDependencies({
    runCommand(_lookup, args) {
      return { status: args[0] === "gh" && !options.hasGh ? 1 : 0 } as never;
    },
    async runAsyncCommand(command, args, spawnOptions) {
      calls.push({ command, args, env: spawnOptions?.env });
      options.onCall?.();
      const status = options.status ?? 0;
      if (status === 0) {
        const dir = command === "gh" ? args[3]! : args[args.length - 1]!;
        mkdirSync(dir, { recursive: true });
        options.build?.(dir);
      }
      return { status, stdout: "", stderr: options.stderr ?? "" };
    },
  });
  return calls;
}

describe("fetchRemoteSource (mocked spawn)", () => {
  it("passes the shallow clone flags and a prompt-free env", async () => {
    const calls = mockClone({});
    const remote = await fetchRemoteSource("https://github.com/o/r");
    remote.cleanup();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("git");
    expect(calls[0]!.args.slice(0, 4)).toEqual(["clone", "--depth", "1", "--single-branch"]);
    expect(calls[0]!.args).not.toContain("--branch");
    // `--` before the URL: a repo argument beginning with `-` must never land in option position.
    expect(calls[0]!.args.slice(4, 6)).toEqual(["--", "https://github.com/o/r"]);
    expect(calls[0]!.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(calls[0]!.env?.GIT_ASKPASS).toBe("");
    expect(calls[0]!.env?.GIT_SSH_COMMAND).toContain("BatchMode=yes");
  });

  it("passes --branch when the URL carried a ref", async () => {
    const calls = mockClone({});
    const remote = await fetchRemoteSource("https://github.com/o/r/tree/main");
    remote.cleanup();
    expect(calls[0]!.args.slice(0, 6)).toEqual(["clone", "--depth", "1", "--single-branch", "--branch", "main"]);
  });

  it("keeps an option-shaped SCP-like URL out of option position", async () => {
    const calls = mockClone({ status: 1 });
    await expect(fetchRemoteSource("--upload-pack=touch pwned@h:o/r")).rejects.toThrow(/Failed to clone/u);
    expect(calls[0]!.args.indexOf("--upload-pack=touch pwned@h:o/r")).toBeGreaterThan(calls[0]!.args.indexOf("--"));
  });

  it("retries a failed github.com clone through gh exactly once", async () => {
    const calls = mockClone({ status: 1, stderr: "fatal: could not read Username", hasGh: true });
    await expect(fetchRemoteSource("https://github.com/o/r/tree/main")).rejects.toThrow(/Failed to clone/u);

    expect(calls).toHaveLength(2);
    expect(calls[1]!.command).toBe("gh");
    expect(calls[1]!.args.slice(0, 3)).toEqual(["repo", "clone", "o/r"]);
    expect(calls[1]!.args.slice(4)).toEqual(["--", "--depth", "1", "--single-branch", "--branch", "main"]);
    expect(calls[1]!.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(calls[1]!.env?.GIT_ASKPASS).toBe("");
    expect(calls[1]!.env?.GIT_SSH_COMMAND).toContain("BatchMode=yes");
  });

  it("does not retry through gh once the clone was aborted, and removes the temp directory", async () => {
    // An abort (Ctrl-C) and a clone timeout both surface as a failed run, so without the signal
    // check the gh retry would start a second clone the user already cancelled.
    const controller = new AbortController();
    const before = tempRemoteDirs();
    const calls = mockClone({ status: 1, stderr: "aborted", hasGh: true, onCall: () => controller.abort() });
    await expect(fetchRemoteSource("https://github.com/o/r", { signal: controller.signal })).rejects.toThrow(
      /Failed to clone/u,
    );
    expect(calls).toHaveLength(1);
    expect(tempRemoteDirs()).toEqual(before);
  });

  it("does not retry a non-GitHub remote", async () => {
    const calls = mockClone({ status: 1, stderr: "fatal: repository not found", hasGh: true });
    await expect(fetchRemoteSource("https://gitlab.com/o/r")).rejects.toThrow(/repository not found/u);
    expect(calls).toHaveLength(1);
  });

  it("does not retry when gh is absent", async () => {
    const calls = mockClone({ status: 1, stderr: "fatal: repository not found", hasGh: false });
    await expect(fetchRemoteSource("https://github.com/o/r")).rejects.toThrow(/repository not found/u);
    expect(calls).toHaveLength(1);
  });

  it("fails when git is not on PATH", async () => {
    __test.setRuntimeDependencies({
      runCommand() {
        return { status: 1 } as never;
      },
    });
    await expect(fetchRemoteSource("https://github.com/o/r")).rejects.toThrow(/git is required for remote sources/u);
  });

  it("descends into the subdirectory and derives its name", async () => {
    mockClone({
      build(dir) {
        write(join(dir, "presets", "team", "config.yaml"), "");
      },
    });
    const remote = await fetchRemoteSource("https://github.com/o/r/tree/main/presets/team");
    try {
      expect(remote.dir.endsWith(join("presets", "team"))).toBe(true);
      expect(remote.name).toBe("team");
    } finally {
      remote.cleanup();
    }
  });

  it("prefers the preset.yaml name", async () => {
    mockClone({
      build(dir) {
        write(join(dir, "preset.yaml"), "name: Fancy\n");
      },
    });
    const remote = await fetchRemoteSource("https://github.com/o/r.git");
    try {
      expect(remote.name).toBe("Fancy");
    } finally {
      remote.cleanup();
    }
  });

  // The name reaches the parse and build logs well before the trust gate, so a hostile `preset.yaml`
  // could otherwise rewrite the screen the user is about to make a trust decision on. Sanitizing at
  // ingestion means every consumer downstream gets a name that is already safe to print.
  it("neutralises control characters in a preset.yaml name", async () => {
    const ESC = String.fromCharCode(27);
    mockClone({
      build(dir) {
        write(join(dir, "preset.yaml"), `name: ${JSON.stringify(`ev${ESC}[2Kil`)}\n`);
      },
    });
    const remote = await fetchRemoteSource("https://github.com/o/r.git");
    try {
      expect(remote.name).not.toContain(ESC);
      const BACKSLASH = String.fromCharCode(92);
      expect(remote.name).toBe(`ev${BACKSLASH}u001b[2Kil`);
    } finally {
      remote.cleanup();
    }
  });

  it("falls back to the last URL segment", async () => {
    mockClone({});
    const remote = await fetchRemoteSource("git@github.com:o/my-repo.git");
    try {
      expect(remote.name).toBe("my-repo");
    } finally {
      remote.cleanup();
    }
  });

  it("throws when the subdirectory is missing", async () => {
    mockClone({});
    await expect(fetchRemoteSource("https://github.com/o/r/tree/main/presets/team")).rejects.toThrow(
      /Subdirectory not found in https:\/\/github.com\/o\/r\/tree\/main\/presets\/team: presets\/team/u,
    );
  });

  it("rejects a cloned tree containing a symlink", async () => {
    mockClone({
      build(dir) {
        write(join(dir, "nested", "keep.txt"), "");
        // Junctions need no elevation on Windows and lstat reports them as symlinks.
        symlinkSync(join(dir, "nested"), join(dir, "nested", "escape"), "junction");
      },
    });
    await expect(fetchRemoteSource("https://github.com/o/r")).rejects.toThrow(
      /symlink, which is not allowed.*escape/su,
    );
  });

  it("rejects a symlinked subdirectory root before descending into it", async () => {
    mockClone({
      build(dir) {
        write(join(dir, "elsewhere", "secret.txt"), "");
        mkdirSync(join(dir, "presets"), { recursive: true });
        symlinkSync(join(dir, "elsewhere"), join(dir, "presets", "team"), "junction");
      },
    });
    await expect(fetchRemoteSource("https://github.com/o/r/tree/main/presets/team")).rejects.toThrow(
      /symlink, which is not allowed.*team/su,
    );
  });

  it("keeps URL credentials out of the log line and the returned URL", async () => {
    const lines: string[] = [];
    const calls = mockClone({});
    const remote = await fetchRemoteSource("https://user:s3cret@github.com/o/r", { logger: captureLogger(lines) });
    try {
      // The clone itself must still carry the credentials.
      expect(calls[0]!.args).toContain("https://user:s3cret@github.com/o/r");
      expect(remote.url).toBe("https://github.com/o/r");
      expect(lines.join("\n")).not.toContain("s3cret");
    } finally {
      remote.cleanup();
    }
  });

  it("redacts a password containing an @ in full", async () => {
    mockClone({ status: 1, stderr: "fatal: unable to access 'https://user:p@ss@github.com/o/r/'" });
    const message = await fetchRemoteSource("https://user:p@ss@github.com/o/r").then(
      () => "clone unexpectedly succeeded",
      (cause: Error) => cause.message,
    );
    expect(message).not.toContain("p@ss");
    expect(message).not.toContain("ss@github.com");
    expect(message).toContain("https://github.com/o/r");
  });

  it("forces ssh batch mode ahead of an inherited BatchMode=no", async () => {
    const previous = process.env.GIT_SSH_COMMAND;
    process.env.GIT_SSH_COMMAND = "ssh -o BatchMode=no -i key";
    try {
      const calls = mockClone({});
      const remote = await fetchRemoteSource("https://github.com/o/r");
      remote.cleanup();
      // ssh takes the first value of a repeated option, so ours must precede the inherited one.
      expect(calls[0]!.env?.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes -o BatchMode=no -i key");
    } finally {
      if (previous === undefined) delete process.env.GIT_SSH_COMMAND;
      else process.env.GIT_SSH_COMMAND = previous;
    }
  });

  it("redacts URL credentials echoed back by git stderr", async () => {
    mockClone({ status: 1, stderr: "fatal: unable to access 'https://user:s3cret@github.com/o/r/'" });
    const message = await fetchRemoteSource("https://user:s3cret@github.com/o/r").then(
      () => "clone unexpectedly succeeded",
      (cause: Error) => cause.message,
    );
    expect(message).not.toContain("s3cret");
    expect(message).toContain("https://github.com/o/r");
  });
});

function captureLogger(lines: string[]): Logger {
  const push = (message: string) => void lines.push(message);
  return { info: push, success: push, warn: push, error: push, dim: push, header: push };
}
