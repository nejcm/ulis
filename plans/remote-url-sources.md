# Remote (git repo) sources and presets

Status: implemented; released in 0.7.0 (`master`, `56a2ef4 chore(release): 0.7.0`, feature commit
`4e97f2e feat(install): remote sources via git clone`). No git tag was cut — tags stop at `v0.0.1-beta.1`.
`develop` still reads 0.6.1 and is three commits behind `master`.
Design date: 2026-08-17 (revised 2026-08-17 — archive download → git clone)

---

## 1. Context

A ULIS source tree must currently live on disk. `--source <path>` is resolved against the filesystem
and errors if the path is missing ([`src/utils/resolve-source.ts:35`](../src/utils/resolve-source.ts)),
and presets resolve only from `~/.ulis/presets/` or the bundled `dist/presets/`
([`src/utils/resolve-presets.ts:86`](../src/utils/resolve-presets.ts)). Sharing a team config therefore
means "clone this repo first, then point ULIS at it".

**Goal:** a user can point `--source` — or a preset ref — at a git repository URL, and every downstream
behaviour (build, validate, install, prune, manifest) is identical. One primitive does the work:
*shallow-clone a repo into a temp directory, then hand that directory to the existing code paths.* ULIS
does the "clone it first" step for you; nothing after the clone knows the source was remote.

**Why clone and not download.** An earlier revision of this plan fetched `.tar.gz` archives over
`fetch()` and unpacked them with the system `tar`, mirroring the `skills` CLI
([vercel-labs/skills](https://github.com/vercel-labs/skills)). Cloning deletes most of that machinery:
no streaming download, no `tar` shell-out, no zip-bomb size caps, no tarball path-traversal guard. It
also gains private repositories and SSH remotes for free, since git already owns the user's credentials.
The price is that `git` becomes a hard runtime dependency for remote sources — previously ULIS only ever
shelled out to `npx`/`bunx`. Recorded in ADR 0003 (§3.9).

## 2. Decisions

Settled during the design interview. Each row is a closed question — reopen deliberately, not by drift.

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | Surfaces | Both `--source <url>` and preset refs | A preset *is* a source tree; one clone primitive serves both |
| 2 | Accepted URLs | Any git remote over HTTPS or SSH. GitHub/GitLab web URLs additionally parse `<ref>` and `<subdir>` from the path; a `#<ref>` fragment works on any host | Clone is host-agnostic, so a host allowlist would be code that only *removes* capability |
| 3 | Mechanism | `git clone --depth 1 --single-branch [--branch <ref>]` into a temp dir | Shallowest thing that works; no new dependency beyond `git` itself |
| 4 | GitHub auth | Plain `git` first; on **any** clone failure for a `github.com` URL, retry once via `gh repo clone` when `gh` is on `PATH` | Uses `gh`'s token when the user has one, without probing `gh auth status` or preferring an unauthenticated `gh` over a working `git` |
| 5 | Lifetime | Temp dir per run, removed in `finally` | No cache invalidation question, no diverged-local-copy question |
| 6 | Trust | Print the commands a remote source's `extensions.yaml`/`skills.yaml` will run; require y/N; `-y` bypasses | Local presets you authored, remote ones you did not |
| 7 | Naming | `preset.yaml` `name` → repo directory name → last URL path segment | Name is display/merge-order identity only |
| 8 | Refs | Branch or tag only (`--branch` accepts both). A commit SHA is rejected with an explicit message | SHA checkout needs `init`+`fetch`+`checkout`; not worth it until asked |
| 9 | Limits | HTTPS/SSH only, 60s clone timeout, symlinks in the cloned tree rejected | Bytes land as real files with no amplification, so byte caps bought nothing; a hung remote is the failure users actually hit |
| 10 | `build --source <url>` | Rejected with a clear error | Build writes `generated/` into the source tree, which is then deleted — a no-op with a progress bar |
| 11 | destBase | CWD when no `--global`; `~` with `--global` | A temp dir has no meaningful parent (today's rule at `resolve-source.ts:40`) |
| 12 | Identity | Full URL in log lines; derived short name in `ResolvedPreset.name` and the ownership manifest | Honest provenance in logs without URLs leaking into merge keys and diagnostics |

**Out of scope** (deliberately, not accidentally): `owner/repo` shorthand (ambiguous against preset names
and relative paths), commit-SHA refs, `.tar.gz`/`.zip` archive URLs, `http://` and `git://`, Bitbucket
web-URL parsing (one parse-table row when someone asks), caching, a preset registry, a dedicated TUI
screen for remote presets, a subdir syntax for non-GitHub/GitLab hosts.

**Documentation deferred by the user:** `docs/guide/presets.md` and `docs/CLI.md` were *not* selected at
design time. That deferral no longer holds — the implementation shipped with `docs/guide/remote-sources.md`,
[ADR 0003](../docs/adr/0003-remote-sources-via-git-clone.md), and updates to `docs/CLI.md` and
`docs/guide/presets.md`.

## 3. Implementation

### 3.1 New module — `src/utils/remote-source.ts`

The feature is one module plus call-site wiring.

```ts
export function isRemoteSource(value: string): boolean;
export function parseRepoUrl(url: string): { cloneUrl: string; ref?: string; subdir?: string };
export function fetchRemoteSource(
  url: string,
  options?: { signal?: AbortSignal; logger?: Logger },
): Promise<RemoteSource>;

export interface RemoteSource {
  readonly dir: string;      // clone root (or subdir), ready for existing code paths
  readonly url: string;      // original URL, for logging
  readonly name: string;     // derived short identity
  readonly cleanup: () => void;
}
```

**`isRemoteSource`** — true for `https://…`, `ssh://…`, and the SCP-like `git@host:owner/repo` shape.
A bare Windows path like `C:\presets` must **not** match; `new URL()` treats `c:\...` as a valid URL with
protocol `c:`, so gate on a protocol allowlist, never on "did `new URL` throw". The SCP-like form is not
a parseable URL at all — match it with an explicit `/^[^/\\]+@[^/\\:]+:/` style test, which also keeps
`C:\...` out.

**`parseRepoUrl`** — parse table:

| Input | Output |
|---|---|
| `https://github.com/<o>/<r>` | `cloneUrl` as-is |
| `https://github.com/<o>/<r>/tree/<ref>` | `cloneUrl` = `https://github.com/<o>/<r>`, `ref` |
| `https://github.com/<o>/<r>/tree/<ref>/<subdir…>` | as above, plus `subdir` |
| `https://gitlab.com/<o>/<r>/-/tree/<ref>[/<subdir…>]` | same treatment |
| `<any git url>#<ref>` | `cloneUrl` without the fragment, `ref` |
| `git@host:<o>/<r>.git`, `ssh://git@host/<o>/<r>` | `cloneUrl` as-is |
| any other `https://…` | `cloneUrl` as-is — let `git` decide whether it is a repo |
| `http://…`, `git://…` | throw — "remote sources must use HTTPS or SSH" |

A `<ref>` containing `/` (branch names like `feature/x`) is ambiguous against `<subdir>` in the web-URL
forms. Take the first segment as the ref and document that slashed branch names need the `#<ref>`
fragment instead — unlike the archive design, that escape hatch now exists and actually works, because
`git clone --branch feature/x` is valid.

Anything that is not a repo (`https://example.com/thing.zip`) is **not** pre-validated. `git` fails and
we wrap its stderr; inventing a shape check for arbitrary hosts would be guessing.

**`fetchRemoteSource`** —

1. `mkdtempSync(join(tmpdir(), "ulis-remote-"))` — same pattern as
   [`src/install.ts:268`](../src/install.ts).
2. Reject a ref that looks like a commit SHA (`/^[0-9a-f]{7,40}$/i`) with a message naming branches and
   tags — `--branch <sha>` fails with a confusing git error otherwise.
3. `git clone --depth 1 --single-branch [--branch <ref>] <cloneUrl> <temp>/repo`, through the existing
   async command runner ([`src/install.ts:634`](../src/install.ts) — `runAsyncCommand`, which resolves a
   status object rather than throwing) so `signal` and error formatting behave like the rest of install.
   Spawn env adds `GIT_TERMINAL_PROMPT=0` and an empty `GIT_ASKPASS`: an unauthenticated private repo
   must fail fast instead of blocking on a `Username:` prompt, which would hang the CLI and wreck the TUI
   (which owns the terminal). Documented consequence: users who rely on a typed-password flow get an
   error telling them to configure a git credential helper.
4. Timeout: 60s, no flag. Wire it as an `AbortSignal` composed with the caller's `signal` — `install.ts`
   already threads `signal` through the async runner. This is a hang guard, not a security control.
5. Non-zero status → if the URL host is `github.com` and `gh` is on `PATH`, retry **once** with
   `gh repo clone <o>/<r> <temp>/repo -- --depth 1 --single-branch [--branch <ref>]`. Retry on *any*
   failure rather than sniffing stderr for "Authentication failed" / "Repository not found" — the wasted
   retry only ever happens on an already-failing path. Known cost: a 404 URL fails twice, roughly
   doubling error latency in that case. Still failing → throw `failed to clone <url>` plus the last
   stderr line via the existing `formatCommandFailure` shape.
6. Descend into `<subdir>` when the URL carried one; a missing subdir throws naming both the URL and the
   path. There is no top-level-directory strip — unlike a tarball, `git clone <dir>` *is* the tree root.
7. Walk the tree and **reject symlinks** (`lstatSync().isSymbolicLink()`), naming the offending entry. A
   repo can contain a symlink pointing at `~/.ssh`, and later reads would follow it. Cheap `readdirSync`
   recursion, skipping `.git/`; no dependency.
8. Derive `name`: reuse `loadConfigFile(dir, "preset")` + `PresetMetaSchema` exactly as
   [`src/presets.ts:30`](../src/presets.ts) does → repo directory name → last URL path segment (minus
   `.git`).
9. `cleanup()` = `rmSync(tempRoot, { recursive: true, force: true })`. Idempotent. On Windows, `.git`
   objects are read-only — `force: true` handles it, but this is the spot to check if cleanup ever leaks.

**`git` availability.** Probe with the existing `commandExists` helper in
[`src/install.ts:579`](../src/install.ts) — lift it to a shared util rather than copying it — and fail
with: *"git is required for remote sources — install git, or clone the repo manually and use
`--source <path>`."* No archive fallback; a fallback would resurrect everything this revision deletes.

### 3.2 `src/utils/resolve-source.ts`

`resolveSource` is synchronous and used by both `installCmd` and `buildCmd`. Keep it synchronous and
network-free; add the remote branch as a sibling:

- Extend `ResolvedSource["mode"]` with `"remote"`.
- Add `export async function resolveSourceOrRemote(options): Promise<ResolvedSource & { cleanup?: () => void }>`:
  when `isRemoteSource(options.source)`, fetch it and return
  `{ sourceDir: remote.dir, destBase: options.global ? homedir() : cwd, mode: "remote", cleanup }`.
  Otherwise delegate to the existing `resolveSource` unchanged.

This keeps every existing `resolveSource` caller and its tests untouched.

### 3.3 `src/commands/install.ts`

Swap `resolveSource` for `resolveSourceOrRemote`; wrap the body in `try { … } finally { cleanup?.(); }`.
Log the **URL** as the source, not the temp path — `runInstall` currently logs `Source: ${sourceDir}`
([`src/install.ts:191`](../src/install.ts)), so pass an optional `sourceLabel` through `InstallOptions`
and prefer it when present.

### 3.4 `src/commands/build.ts`

Reject a remote `--source` before doing any work:

> `build` writes generated output into the source tree, and a remote source is discarded after the run.
> Use `ulis install --source <url>` instead.

Same check in the `validate` path only if validate writes nothing — it does not, so **validate may accept
URLs**; wire it through `resolveSourceOrRemote` with the same `finally` cleanup.

### 3.5 Preset refs — `src/utils/resolve-presets.ts`

In `resolvePresets`, before the local-root lookup, branch on `isRemoteSource(name)`: fetch, push
`{ name: derived, dir: remote.dir, remoteUrl: url }`. The `onMissing` prompt/skip/error logic does not
apply to URLs — a clone failure is an error regardless of `onMissing`, since "continue without it"
silently changes what gets installed.

Cleanups must reach the caller. Return a small wrapper rather than a bare array:

```ts
export interface ResolvedPresets {
  readonly presets: readonly ResolvedPreset[];
  readonly cleanup: () => void;   // no-op when nothing was cloned
}
```

Both call sites ([`src/commands/preset.ts:67`](../src/commands/preset.ts),
[`src/commands/install.ts:28`](../src/commands/install.ts)) then use `try/finally`. `ResolvedPreset`
gains an optional `remoteUrl?: string`.

`parsePresetNames` splits on commas ([`resolve-presets.ts:78`](../src/utils/resolve-presets.ts)) — no
accepted URL form contains a comma, so comma-separated lists keep working and may mix local names with
URLs.

### 3.6 Trust gate — `src/install.ts`

Both `runInstall` and `runPresetInstall` funnel into `installGeneratedOutput`, which is where the gate
belongs — one place, both paths, no duplicated logic.

- `GeneratedInstallOptions` gains `remoteSources?: readonly string[]` (the URLs contributing to this run)
  and `nonInteractive?: boolean`.
- Before the `installSkills` / `installExtensions` blocks: if `remoteSources` is non-empty, at least one
  of `installSkillsEnabled` / `installExtensionsEnabled` is true, and there is at least one entry to run,
  print the remote URL(s) and every command that will execute — `npx skills@latest add <name> …` and
  `<runner> <extension> …`, exactly as they will be spawned — then `confirm("Run these commands?")`.
  The gate sits above every write, not just above `npx`/`bunx`: declining installs nothing at all —
  not the commands, and not the generated config files either; say so in the log line, since a
  half-install the user did not expect is worse than either extreme.
- `nonInteractive` (`-y`) skips the prompt entirely.

`confirm()` is currently duplicated in [`src/commands/preset.ts:101`](../src/commands/preset.ts) and
[`src/utils/resolve-presets.ts:64`](../src/utils/resolve-presets.ts). Lift it to `src/utils/prompt.ts`
and have all three use it rather than writing a third copy.

**Manifest.** Entries stay keyed by the derived short name; the ownership manifest records relative agent
files and local skill dirs ([`src/install/manifest.ts`](../src/install/manifest.ts)) and needs no schema
change — a remote-sourced agent is owned exactly like a local one, so prune keeps working across runs.

### 3.7 TUI

The `customSource` and `customPresetSource` screens already accept free-text
([`src/tui/view.ts:89`](../src/tui/view.ts)). Let a submitted value be a URL:

- Controller submit path routes the value through the same `isRemoteSource` check and resolver.
- Show the clone as a progress notice (`Cloning <url>…`), and surface failures as a `state.notice` like
  the existing "No presets found in custom directory" message
  ([`src/tui/controller.ts:118`](../src/tui/controller.ts)).
- `GIT_TERMINAL_PROMPT=0` (§3.1) matters most here: a git credential prompt inside the TUI would fight
  the TUI for stdin.
- Persisted preferences already store `customSource` / `customPresetSource` strings — a URL round-trips
  as-is, no schema change.
- `listTuiPresets`'s unused `customRoot` stays as-is: a remote preset ref is a *ref*, not a root to scan.
- No new screen, no new preference scope (there are already four).

### 3.8 CLI help — `src/cli.ts`

`--source <path>` → `--source <path|url>` on `install` and `validate` (not `build`); `--preset <names>`
description mentions that a name may be a git repository URL. Both occurrences on `install`
(line 49/54) and the `preset` command block.

### 3.9 Docs

- **`CONTEXT.md`** — add:
  > **Remote Source**: A source tree shallow-cloned from a git repository into a temporary directory for
  > the duration of a single run. It is discarded afterwards and is never cached.

  Amend **Source** and **Preset** to note either may be remote.
- **`docs/adr/0003-remote-sources-via-git-clone.md`** — clone-over-download. Context: shared team
  configs. Alternatives: HTTPS archive download + `tar` (rejected — needs streaming download, size caps,
  and a tarball traversal guard, and supports neither private repos nor SSH), per-file API crawl, a
  preset registry. Consequences: `git` becomes a hard runtime dependency for remote sources; refs are
  limited to branches and tags; nothing is cached. What would justify revisiting: a demand for
  git-less environments, or SHA pinning. Follows the format of the two existing ADRs.

## 4. QA

### 4.1 Automated

Split by concern: real git for behaviour, mocked spawn for argv. **New prerequisite: `git` must be on
`PATH` in CI** — previously the test suite needed no external binary.

**New — `src/utils/remote-source.test.ts`**

*Parse table (pure, no spawn):*

| Case | Expectation |
|---|---|
| `isRemoteSource` on `https://…`, `ssh://…`, `git@github.com:o/r.git` | `true` |
| `isRemoteSource` on `C:\presets`, `/home/x/presets`, `./rel`, `team` | `false` — Windows drive letters are the trap |
| Plain GitHub repo URL | `cloneUrl` unchanged, no `ref`, no `subdir` |
| `/tree/main` | `cloneUrl` stripped to repo root, `ref === "main"` |
| `/tree/main/presets/team` | as above, `subdir === "presets/team"` |
| GitLab `/-/tree/<ref>/<subdir>` | same treatment |
| `https://git.corp/x/y.git#v1.2.3` | fragment stripped, `ref === "v1.2.3"` |
| `git@github.com:o/r.git` | passthrough, no ref |
| `https://example.com/thing.zip` | passthrough — not pre-validated, git decides |
| `http://…`, `git://…` | throws, message names HTTPS or SSH |
| `/tree/<40-hex-sha>` | throws, message names branches and tags |

*Clone behaviour (real `git`, `file://` remote — no network):* build fixture repos in `beforeAll` with
`git init` + two commits, then clone from their `file://` path.

| Case | Expectation |
|---|---|
| Clone of a fixture repo | `dir` contains the committed files, `.git` present |
| Clone with `ref` = a fixture tag/branch | that ref's content, not the default branch |
| Subdir descent | fixture with `presets/team/preset.yaml` + `subdir` → `dir` is the team dir |
| Missing subdir | throws naming URL and path |
| Fixture repo containing a symlink | throws naming the entry |
| Nonexistent `file://` path | throws with the git stderr tail |
| Name derivation | `preset.yaml` name wins; then repo dir name; then URL last segment |
| `cleanup()` twice | idempotent, no throw; temp dir gone (Windows read-only `.git` objects included) |

*Mocked spawn (via `__test.setRuntimeDependencies`, [`src/install.ts:679`](../src/install.ts)):*

- argv is `clone --depth 1 --single-branch <url> <dir>`; `--branch <ref>` present only when a ref was parsed.
- Spawn env carries `GIT_TERMINAL_PROMPT=0`.
- Failure + `github.com` URL + `gh` present → exactly one `gh repo clone` retry, with the git flags after `--`.
- Failure + non-GitHub URL → **no** retry.
- Failure + `gh` absent → no retry, git's stderr surfaced.
- Timeout fires → temp dir removed.

**Extended — `src/utils/resolve-source.test.ts`**

- Remote source, no `--global` → `destBase === cwd`, `mode === "remote"`.
- Remote source with `--global` → `destBase === homedir()`.
- Every existing local case unchanged (regression guard on the sync path).

**Extended — `src/utils/resolve-presets.test.ts`**

- A URL ref resolves to a cloned dir with the derived name.
- Mixed `local-name,https://…` list resolves both.
- Clone failure throws regardless of `onMissing: "skip"`.
- `cleanup()` removes cloned dirs and no-ops for an all-local list.

**Extended — `src/install.test.ts`**

- Remote source + declined prompt → **no** `npx`/`bunx` spawn, nothing written.
- Remote source + accepted prompt → commands spawned as listed.
- Remote source + `-y` → no prompt, commands spawned.
- Purely local source → no prompt at all (regression guard: the gate must not fire for local runs).
- The prompt text lists each command verbatim.

**Extended — `src/commands/commands.test.ts` / `src/cli-prune.test.ts`**

- `build --source <url>` exits with the rejection message.
- `validate --source <url>` is accepted.

### 4.2 Manual QA checklist

Run from a scratch directory, not the repo. These URLs work because this repo keeps its source tree in
`example/` and its presets in `example/presets/*` — the subdir case is the normal case, not an edge one.

1. **Happy path, project install**
   `ulis install --source https://github.com/nejcm/ulis/tree/master/example --target claude`
   → log shows `Source: https://github.com/…` (URL, not a temp path); collision prompt lists
   *scratch-dir* paths; `.claude/` contains generated output; `%TEMP%\ulis-remote-*` is gone afterwards.
2. **Subdirectory preset**
   `ulis preset install https://github.com/nejcm/ulis/tree/master/example/presets/react-web --target claude`
   → installs only that preset; `Presets:` line shows the derived name.
3. **Ref selection** — swap `master` for a tag; confirm the installed content matches that tag. Then try a
   branch name containing `/` via the fragment form (`…/ulis.git#feature/x`) and confirm the greedy-ref
   caveat from §3.1 holds.
4. **Trust gate** — point at a source whose `extensions.yaml` is non-empty; decline → no `npx` runs,
   nothing lands at all, log reads "Declined. Nothing from the remote source was installed." Re-run
   with `-y` → no prompt.
5. **Global install** — add `--global`; verify writes go to `~/.claude` etc., not the temp parent.
6. **Build rejection** — `ulis build --source https://…` → clear error naming `install`.
7. **Non-GitHub host** — any reachable GitLab or self-hosted repo, with and without `#<ref>`. Confirm no
   `gh` retry is attempted (§4.1 covers it in a mock; verify once for real).
8. **Private repo** — a private GitHub repo, three ways: with a git credential helper configured (works);
   with only `gh auth login` (works via the retry); with neither (**fails fast**, does not hang waiting on
   `Username:`). The third is the one that matters — verify it in both the CLI and the TUI.
9. **Failure modes** — 404 URL; `http://` URL; `.zip` URL; a valid repo whose tree has no ULIS files; a
   SHA in place of a ref. Each: actionable message, no partial install, temp dir removed. Verify by
   listing `%TEMP%` before and after.
10. **Interrupt and timeout** — Ctrl-C mid-clone → temp dir removed (the `finally` must survive the abort
    path already used by `throwIfAborted`). Point at an unroutable host to confirm the 60s timeout fires
    rather than hanging.
11. **`git` absent** — temporarily shadow `git` off `PATH` → the actionable message from §3.1, no partial
    state.
12. **Windows + POSIX** — run 1, 2, and 8 on both if available; argument quoting and `.git` read-only
    cleanup are the likely divergences.
13. **TUI** — `ulis tui` → custom-source flow, paste a URL, confirm the plan screen shows it and the
    install completes; error case shows a notice instead of crashing the TUI.
14. **Prune across runs** — install from a remote source, then re-install from the same source with one
    agent removed upstream → the stale agent is pruned (manifest identity survives the temp-dir churn).

### 4.3 Security review points

Worth a deliberate look during implementation review, not just tests. Cloning removes the two worst items
from the archive design (tarball path traversal, gzip amplification) — `git` will not write outside the
target directory. What is left:

- **Symlink escape.** A repo can commit a symlink pointing outside the clone (`~/.ssh`, `../../`), which
  later reads would follow. Reject symlinks during the post-clone walk (§3.1 step 7). **Highest-risk item
  in the change.**
- **Credential prompt hijack.** Without `GIT_TERMINAL_PROMPT=0`, a hostile or merely private URL makes git
  prompt for a username/password on the terminal ULIS owns — indistinguishable from a ULIS prompt to the
  user. Verify the env var is set on every clone path, including the `gh` retry.
- **HTTPS/SSH only.** `git://` is unauthenticated and unencrypted; cloning code you are about to offer to
  execute over it is the wrong default.
- **The trust prompt is a real boundary**, not a nicety: it is the only thing between a pasted URL and
  arbitrary `npx` execution. Do not let a refactor route around it, and keep the local path prompt-free
  so the prompt keeps meaning something.
- **No byte caps by design** (decision #9). A hostile repo can still fill a disk within the 60s window.
  Accepted: the same is true of the `git clone` the user would otherwise run by hand.

### 4.4 Exit checks

```bash
bun run lint && bun run test
```

Both green plus the manual checklist before this is called done.

## 5. Rollback

Self-contained: the feature is additive behind `isRemoteSource`. Reverting means deleting
`src/utils/remote-source.ts` and the `resolveSourceOrRemote` branch; every local path is untouched by
design, which is also why the "local run must not prompt" regression test matters.
