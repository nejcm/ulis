import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

import type { Logger } from "../build.js";
import { formatCommandFailure, runCommand, runSkillCommand } from "../install.js";
import { PresetMetaSchema } from "../schema.js";
import { commandExists } from "./command.js";
import { loadConfigFile } from "./config-loader.js";
import { hasUnredactableCredential, redactUserinfo, sanitizeLogText } from "./redact.js";

export interface RemoteSource {
  /** Clone root (or its subdir), ready for the existing code paths. */
  readonly dir: string;
  /** Original URL, for logging. */
  readonly url: string;
  /** Derived short identity. */
  readonly name: string;
  readonly cleanup: () => void;
}

export interface ParsedRepoUrl {
  readonly cloneUrl: string;
  readonly ref?: string;
  readonly subdir?: string;
}

/** Hosts whose web URLs (`/tree/<ref>/<subdir>`) are understood. */
const WEB_URL_HOSTS = new Set(["github.com", "gitlab.com"]);
const SCP_LIKE = /^[^/\\:]+@[^/\\:]+:/u;
const REMOTE_PROTOCOL = /^(?:https?|ssh|git):\/\//iu;
const REJECTED_PROTOCOL = /^(?:http|git):\/\//iu;
const COMMIT_SHA = /^[0-9a-f]{7,40}$/iu;
const GITHUB_SLUG = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/iu;
const CLONE_TIMEOUT_MS = 60_000;

/**
 * True for URL-shaped sources: `https://…`, `ssh://…`, and the SCP-like `git@host:owner/repo`.
 * `http://` and `git://` match on purpose so {@link parseRepoUrl} can reject them with a real message.
 * A Windows path such as `C:\presets` must not match — hence the protocol allowlist rather than
 * a `new URL()` probe, which happily parses `c:\…` as protocol `c:`.
 */
export function isRemoteSource(value: string): boolean {
  const trimmed = value.trim();
  return REMOTE_PROTOCOL.test(trimmed) || SCP_LIKE.test(trimmed);
}

/**
 * Split a source URL into the URL to clone plus an optional ref and subdirectory.
 * Anything that is not a recognised web URL passes through untouched — `git` decides whether
 * it is a repository.
 */
export function parseRepoUrl(url: string): ParsedRepoUrl {
  const trimmed = url.trim();
  // Before anything that echoes the URL: a credential in an unredactable shape must never be shown.
  if (hasUnredactableCredential(trimmed)) {
    // Deliberately echoes nothing: such a URL may hold a password in a shape redaction cannot be
    // guaranteed to catch, and a vague message beats one that prints a credential.
    throw new Error(
      "A remote source URL must have a plain host with no whitespace before the path, " +
        "and any `@` in the path must be percent-encoded as %40. " +
        "The URL is not shown here because it may contain a password.",
    );
  }
  if (REJECTED_PROTOCOL.test(trimmed)) {
    throw new Error(`Remote sources must use HTTPS or SSH: ${redactUserinfo(trimmed)}`);
  }

  const hashIndex = trimmed.indexOf("#");
  const base = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  // The web-URL form still has to be stripped off the part before the `#`, or `/tree/<ref>/<subdir>`
  // would be handed to git as part of the clone URL. An explicit `#<ref>` wins over the path's ref,
  // which is what makes it the escape hatch for a branch name containing `/`.
  const web = parseWebUrl(base);
  const ref = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) || undefined : web?.ref;
  return withCheckedRef({ ...(web ?? { cloneUrl: base }), ref });
}

/**
 * Shallow-clone `url` into a temp directory and hand back the tree.
 * The caller owns `cleanup()` — call it in a `finally`.
 */
export async function fetchRemoteSource(
  url: string,
  options: { signal?: AbortSignal; logger?: Logger } = {},
): Promise<RemoteSource> {
  const { cloneUrl, ref, subdir } = parseRepoUrl(url);
  // Clone with the credentials the user supplied, but never show them again.
  const safeUrl = redactUserinfo(url);
  if (!commandExists("git", runCommand)) {
    throw new Error(
      "git is required for remote sources — install git, or clone the repo manually and use `--source <path>`.",
    );
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "ulis-remote-"));
  // Never throws: callers run cleanups in a `while (cleanups.length) cleanups.pop()!()` loop and in
  // the `catch` below, where a throw would strand the remaining temp dirs or mask the real error.
  // Windows holds `.git` pack files open for a moment after git exits, so retry before giving up.
  const cleanup = () => {
    try {
      rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // ponytail: a wedged handle leaks one temp dir under the OS temp root; the OS reclaims it.
    }
  };
  try {
    const repoDir = join(tempRoot, "repo");
    const cloneFlags = ["--depth", "1", "--single-branch", ...(ref ? ["--branch", ref] : [])];
    // `AbortSignal.any` is Node >= 20.3 - see `engines.node`.
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(CLONE_TIMEOUT_MS)])
      : AbortSignal.timeout(CLONE_TIMEOUT_MS);

    options.logger?.info(`Cloning ${safeUrl}...`);
    // `--` so a URL beginning with `-` can never reach git in option position.
    let result = await runGit("git", ["clone", ...cloneFlags, "--", cloneUrl, repoDir], signal);

    // An aborted or timed-out clone reports the same shape as a failed one, so check the signal:
    // retrying would start a second clone the user already cancelled.
    const slug = result.status === 0 || signal.aborted ? undefined : GITHUB_SLUG.exec(cloneUrl);
    if (slug && commandExists("gh", runCommand)) {
      // `gh` carries the user's GitHub token; retry once on any failure rather than sniffing stderr.
      rmSync(repoDir, { recursive: true, force: true });
      result = await runGit("gh", ["repo", "clone", `${slug[1]}/${slug[2]}`, repoDir, "--", ...cloneFlags], signal);
    }
    if (result.status !== 0) {
      throw new Error(`Failed to clone ${safeUrl}: ${redactUserinfo(formatCommandFailure(result))}`);
    }

    // Walk before descending: the subdir root itself can be a symlink, and `statSync`/`readdirSync`
    // would follow it out of the clone.
    rejectSymlinks(repoDir);
    const dir = subdir ? join(repoDir, ...subdir.split("/")) : repoDir;
    // A file at that path would otherwise fail later with a confusing readdir error.
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Subdirectory not found in ${safeUrl}: ${subdir}`);
    }

    return { dir, url: safeUrl, name: deriveName(dir, repoDir, cloneUrl), cleanup };
  } catch (error) {
    cleanup();
    // A failed process launch reports the whole argv, `cloneUrl` and its credentials included.
    // The original is dropped rather than kept as `cause`: that field carries the same raw argv.
    throw error instanceof Error ? new Error(redactUserinfo(error.message)) : error;
  }
}

function runGit(command: string, args: readonly string[], signal: AbortSignal) {
  return runSkillCommand(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    // A credential prompt would hang the CLI and fight the TUI for stdin - fail fast instead.
    // `GIT_TERMINAL_PROMPT` does not cover ssh, which prompts for a key passphrase or an unknown
    // host key on its own; `BatchMode=yes` turns both into an immediate error.
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      GIT_SSH_COMMAND: batchModeSshCommand(process.env.GIT_SSH_COMMAND),
    },
    signal,
    // A hung clone is the failure users hit; SIGTERM leaves git free to ignore it and outlive the
    // 60s timeout. ponytail: this kills the direct child only — a `git-remote-https`/`ssh`
    // grandchild can outlive it on Windows, where signals do not reach the process tree.
    killSignal: "SIGKILL",
  });
}

/**
 * `BatchMode=yes` must come before anything the user inherited: ssh takes the first value of an
 * option, so appending would lose to an inherited `BatchMode=no`.
 */
function batchModeSshCommand(inherited: string | undefined): string {
  const [, program = "ssh", rest = ""] = /^\s*("[^"]*"|\S+)?\s*([\s\S]*)$/u.exec(inherited?.trim() ?? "") ?? [];
  return [program, "-o", "BatchMode=yes", rest].join(" ").trimEnd();
}

function parseWebUrl(url: string): ParsedRepoUrl | undefined {
  if (!/^https:\/\//iu.test(url)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!WEB_URL_HOSTS.has(parsed.hostname.toLowerCase())) return undefined;

  // GitLab marks the end of the namespace with `/-/`, so split on that first: a subgroup may itself
  // be called `tree`. GitHub has no subgroups, so its namespace is exactly `<owner>/<repo>`.
  const gitlabIndex = parsed.pathname.indexOf("/-/tree/");
  const [namespace, rest] =
    gitlabIndex >= 0
      ? [parsed.pathname.slice(1, gitlabIndex), parsed.pathname.slice(gitlabIndex + "/-/tree/".length)]
      : (/^\/([^/]+\/[^/]+)\/tree\/(.+)$/u.exec(parsed.pathname)?.slice(1) ?? []);
  if (!namespace || !rest) return undefined;

  // A ref containing `/` is ambiguous against the subdir; take the first segment and let the
  // `#<ref>` fragment form handle slashed branch names.
  const [ref, ...subdirSegments] = rest
    .split("/")
    .filter((segment) => segment.length > 0)
    // `pathname` keeps percent-escapes, but git and the filesystem want the decoded name.
    .map(decodeSegment);
  return {
    // `URL.origin` drops userinfo, which a private-repo clone needs; rebuild the authority by hand.
    cloneUrl: `${parsed.protocol}//${authority(parsed)}/${namespace}`,
    ref,
    subdir: subdirSegments.length > 0 ? checkSubdir(subdirSegments) : undefined,
  };
}

function authority(parsed: URL): string {
  const userinfo = parsed.username ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@` : "";
  return `${userinfo}${parsed.host}`;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Decoding can turn `..%2F..` into a path that escapes the clone, so a segment must stay one segment.
 */
function checkSubdir(segments: readonly string[]): string {
  for (const segment of segments) {
    if (segment === "." || segment === ".." || /[/\\:]/u.test(segment)) {
      throw new Error(`Remote source subdirectory must stay inside the repository: ${segments.join("/")}`);
    }
  }
  return segments.join("/");
}

function withCheckedRef(parsed: ParsedRepoUrl): ParsedRepoUrl {
  if (parsed.ref && COMMIT_SHA.test(parsed.ref)) {
    throw new Error(`Remote source refs must be a branch or a tag, not a commit SHA: ${parsed.ref}`);
  }
  return parsed;
}

/**
 * A committed symlink can point at `~/.ssh` or outside the clone, and later reads would follow it.
 */
function rejectSymlinks(dir: string, root: string = dir): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Remote source contains a symlink, which is not allowed: ${relative(root, full) || entry.name}`);
    }
    if (entry.isDirectory()) rejectSymlinks(full, root);
  }
}

/**
 * `preset.yaml` name → subdirectory name → last URL path segment.
 *
 * Sanitized here, at the boundary where remote data enters, rather than at each place it is
 * printed. This name reaches the parse and build logs long before the trust gate runs, so a
 * `preset.yaml` naming itself with ANSI escapes could otherwise rewrite the very screen the user
 * is about to make a trust decision on. Every consumer downstream gets a name that is safe to show.
 */
function deriveName(dir: string, repoDir: string, cloneUrl: string): string {
  const raw = loadConfigFile(dir, "preset");
  const meta = raw != null ? PresetMetaSchema.safeParse(raw) : null;
  if (meta?.success && meta.data.name) return sanitizeLogText(meta.data.name);
  if (dir !== repoDir) return sanitizeLogText(basename(dir));

  const path = cloneUrl.replace(/\/+$/u, "").replace(/\.git$/iu, "");
  return sanitizeLogText(path.split(/[/:]/u).pop() || path);
}
