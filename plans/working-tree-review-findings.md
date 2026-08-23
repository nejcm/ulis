# Working-tree review findings

Status: triaged 2026-08-19 against `develop` @ `99d293d` (clean tree) — 8 valid, 3 partial,
2 invalid, 1 obsolete. Nothing here is fixed yet; the fix plan is [§5](#5-fix-plan).
Per-finding verdicts are in [§5.1](#51-triage-verdicts).
Review date: 2026-08-19
Scope: the uncommitted working tree on `develop` (46 files, +1700/-326) validated against
[`plans/tui-plan-item-ids.md`](tui-plan-item-ids.md) and [`plans/remote-url-sources.md`](remote-url-sources.md)
Baseline: `a31fc19` (merge of `master` into `develop`, 2026-08-19 12:43)

Both plans are implemented correctly. `bun run lint` is clean and `bun test` is 666 pass / 0 fail.
Everything below is a follow-up, ordered by whether it can hurt someone.

---

## 1. Security and correctness

### 1.1 Gate bypass: `build --preset <url>` then `install --skip-rebuild`

`buildCmd` accepts remote _presets_ ([`src/commands/build.ts:37`](../src/commands/build.ts)) and writes their
merged output into the local source's `generated/`. A later `ulis install --skip-rebuild` has an empty
`remoteSources`, so the trust gate never fires and the remote-authored MCP servers, hooks and `raw/`
fragments install with no prompt.

This is the same divergence that decision "a remote source cannot skip the build"
([`src/install.ts:278`](../src/install.ts)) closes _within_ one run — it is still open _across_ runs.

Narrow: it needs `--skip-rebuild` (or the TUI's "Use latest build output" left off), and the user did type
the URL at build time. But it is the only path where remote-authored config reaches a destination with no
gate at all.

**Fix direction:** have `runBuild` record remote contributors into the generated tree, and arm the gate when
an install reads one. Rejecting `build --preset <url>` outright is the cheaper alternative, but it removes a
legitimate use (previewing a remote preset's output without installing it).

### 1.2 The TUI's in-process install does not declare its source remote

[`src/tui/actions.ts:202`](../src/tui/actions.ts) calls `runInstall` without `sourceIsRemote`, so the
"is this a clone?" decision falls back to `isClonedSourceDir`, which sniffs the `ulis-remote-` path prefix.
The installer's own comment calls that "naming, not identity". The resolver's `mode` is available at the call
site; passing `sourceIsRemote: true` is one line and retires the heuristic for its only remaining caller.

### 1.3 `isClonedSourceDir` false positives

[`src/install.ts:222`](../src/install.ts) treats any path segment starting with `ulis-remote-` as a clone, so
a user directory named that way silently loses its source `.env` for the run. The skip is logged rather than
silent, and the failure direction is the safe one, so this is acceptable as-is — it exists only because of
1.2 and disappears with it.

## 2. Plan and documentation drift

### 2.1 `remote-url-sources.md` still documents the old decline behaviour

[§3.6](remote-url-sources.md) says declining "skips extensions and external skills but **still installs the
generated config files**", and the §4.1 test row still expects "generated config files still written". The
shipped behaviour is the opposite: the gate moved above every write, and declining installs nothing
([`src/install.ts:465`](../src/install.ts), test at [`src/install.test.ts:2242`](../src/install.test.ts)).

`CONTEXT.md`, ADR 0003, `docs/CLI.md` and `docs/guide/remote-sources.md` were all updated. The plan was not.
Fix it in the same commit as the gate work, or the next reader re-implements the hole.

### 2.2 0.7.0 shipped the weak gate

The released `master` (`56a2ef4`) gates _after_ the config files are written, enumerates what a source
_declares_ rather than what a generator _emits_, and silently declines when there is no TTY. If anyone is
using remote sources on 0.7.0, this is patch-release material rather than merge-only material.

### 2.3 `tui.svg` is stale on this branch

Regenerating with `bun run gen:screenshot` swaps the Summary/Actions pane order versus the committed file.
Not caused by the plan-item change — I generated the frame from the pre-change `state.ts`/`view.ts` and from
the post-change ones and they are byte-identical — but the checked-in screenshot does not match what the
branch renders. Regenerate before release.

## 3. Nits

| #   | Site                                                     | Issue                                                                                                                                                                                                                                                | Suggested change                                                                                                                       |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | [`src/tui/view.ts:168`](../src/tui/view.ts)              | `value ? { value } : {}` is a truthiness test where the type says `string \| undefined`; an empty-string value would silently render as valueless                                                                                                    | `value !== undefined`                                                                                                                  |
| 3.2 | [`src/tui/state.ts:166`](../src/tui/state.ts)            | Nothing checks that plan item ids are unique within a flow. A duplicate would make `planItemCursor` land on the first match while the exhaustiveness switch stays happy                                                                              | One test: `expect(new Set(ids).size).toBe(ids.length)` per flow                                                                        |
| 3.3 | [`src/tui/state.ts:166`](../src/tui/state.ts)            | `readonly PlanItem[]` erases the literal types                                                                                                                                                                                                       | `satisfies readonly PlanItem[]`, which would later allow proving at the type level that `"build"` is absent from the presets-only flow |
| 3.4 | [`src/install.ts:179`](../src/install.ts)                | The TTY check is duplicated: `defaultRuntimeDependencies.confirm` throws on `!stdin.isTTY`, then calls `confirm(..., { requireTty: true })`, which checks again                                                                                      | Drop one; the explicit throw carries the better message, so keep that one                                                              |
| 3.5 | [`src/install/preview.ts:79`](../src/install/preview.ts) | A remote install parses and generates twice — once in `runBuild`, once in the preview that reads the bytes back. Correct by construction, and only remote runs pay it                                                                                | Add a comment saying the second pass is deliberate, so nobody "optimises" the preview into reusing the build's output                  |
| 3.6 | [`src/tui/view.ts:420`](../src/tui/view.ts)              | The remote review header lost its urgency: `These commands come from X and WILL RUN if you continue` became `X contributes the execution surface below`. Accurate now that not everything listed runs immediately, but "execution surface" is jargon | Fold the warning back into the header; keep the follow-up line that explains the two classes                                           |
| 3.7 | [`src/tui/state.ts:706`](../src/tui/state.ts)            | `if (!item) return` is a `noUncheckedIndexedAccess` appeasement; `moveCursor` already clamps the cursor                                                                                                                                              | Leave it, but note it is defensive only                                                                                                |

## 4. Packaging

Nothing has been committed since the 12:43 merge; every changed file has today's mtime. Five workstreams are
stacked in one tree, which is why no single commit-sized story fits any file — `src/tui/state.ts` alone
carries the plan-item refactor _and_ the preset-review re-prepare.

Suggested split, in dependency order:

1. **Interrupt guard** — `src/utils/interrupt.{ts,test.ts}`, `plans/interrupt-guard-resolve.md`
2. **Injection fixes** — `src/generators/shared/keys.*`, `src/generators/shared/security-hooks.*`,
   `src/generators/platforms/**`, `src/schema/**`, `src/schema.test.ts`, `src/utils/config-merger.ts`,
   `tests/golden-artifacts.ts`, `docs/SPEC.md`
3. **Trust-gate rewrite** — `src/install/preview.*`, `src/install.ts`, `src/install.test.ts`, `src/config.ts`,
   `src/utils/{prompt,redact,remote-source}.*`, `src/commands/**`, `CONTEXT.md`, `docs/CLI.md`,
   `docs/guide/remote-sources.md`, `docs/adr/0003-*`, plus the §2.1 fix
4. **TUI plan-item ids** — the `state.ts`/`view.ts` hunks covered by `plans/tui-plan-item-ids.md`
5. **TUI review consent** — `controller.ts`, `actions.ts`, their tests, and the
   `PRESET_INSTALL_REVIEW_*` / `prepareRemoteInstall` hunks in `state.ts`/`view.ts`

4 and 5 need hunk-level splitting (`git add -p`); 1–3 split cleanly by path.

---

## 5. Fix plan

Second-pass triage (2026-08-19) re-verified all 14 findings against `develop` @ `99d293d`, clean tree.
Every line reference below was re-read; where §1–§3 quote a stale line number the corrected one is given here.

### 5.1 Triage verdicts

| #   | Verdict      | Evidence                                                                                                                                                                                                                                                                                                                   |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | **Valid**    | [`buildCmd`](../src/commands/build.ts:19) writes remote-preset output into `generated/` with no provenance; `--skip-rebuild` ([`cli.ts:51`](../src/cli.ts:51)) leaves `remoteSources` empty, so [`confirmRemoteCommands`](../src/install.ts:717) returns `true` on its first line. No test covers the cross-run sequence.  |
| 1.2 | **Valid**    | [`actions.ts:202`](../src/tui/actions.ts:202) omits `sourceIsRemote`; the CLI passes it at [`commands/install.ts:80`](../src/commands/install.ts:80). Correction to the finding: pass `sourceIsRemote: planned.remote`, not `true` — the branch is also entered for a presets-only `remoteRef` whose base source is local. |
| 1.3 | **Valid**    | [`isClonedSourceDir`](../src/install.ts:215) (not `:222`) matches any path segment prefixed `ulis-remote-`, costing that run the source `.env` at [`install.ts:298`](../src/install.ts:298).                                                                                                                               |
| 2.1 | **Valid**    | [`remote-url-sources.md:211`](remote-url-sources.md) and [`:322`](remote-url-sources.md) still promise "generated config files still written" on decline; [`install.test.ts:2242`](../src/install.test.ts:2242) proves nothing is installed.                                                                               |
| 2.2 | **Valid**    | In `v0.7.0` (`56a2ef4`), `installGeneratedOutput` runs `installClaude`/`installCodex`/… _before_ `confirmRemoteCommands`; the gate returns early on `commands.length === 0`; `confirm(..., {requireTty:true})` returns `false` without a TTY. `npm view @nejcm/ulis version` → `0.7.0`.                                    |
| 2.3 | **Valid**    | Reproduced: `bun run gen:screenshot` yields 48 insertions / 50 deletions against the committed `tui.svg`, swapping the Summary/Actions pane order.                                                                                                                                                                         |
| 3.1 | **Partial**  | The truthiness test is real ([`view.ts:168`](../src/tui/view.ts:168)) but every [`planItemValue`](../src/tui/view.ts:182) branch returns a non-empty string or `undefined`. Hardening, not a live bug.                                                                                                                     |
| 3.2 | **Valid**    | Neither `DASHBOARD_ITEMS` ([`state.ts:166`](../src/tui/state.ts:166)) nor `PRESET_ONLY_PLAN_ITEMS` ([`:181`](../src/tui/state.ts:181)) is checked for id uniqueness; no such assertion exists in the TUI tests. [`planItemCursor`](../src/tui/state.ts:1085) takes the first match.                                        |
| 3.3 | **Invalid**  | `satisfies` would preserve the literals, but nothing consumes them today. The stated benefit is a hypothetical future type-level assertion.                                                                                                                                                                                |
| 3.4 | **Valid**    | [`install.ts:183`](../src/install.ts:183) throws on `!stdin.isTTY`, then calls `confirm(..., { requireTty: true })`, which re-checks and returns `false`.                                                                                                                                                                  |
| 3.5 | **Partial**  | Remote installs do parse and generate twice. The finding's rationale is wrong: [`previewInstalledExecution`](../src/install/preview.ts:79) regenerates in memory via `mergedProject` + `generate`, it does not read build artifacts back. The comment to add must say that.                                                |
| 3.6 | **Partial**  | The copy change is confirmed at [`view.ts:420`](../src/tui/view.ts:420). "Lacks urgency" is a judgement call; "execution surface" being jargon is not.                                                                                                                                                                     |
| 3.7 | **Invalid**  | Not redundant. [`moveCursor`](../src/tui/state.ts:1183) returns without touching the cursor for any non-navigation key, so a cursor stale from a previous, longer flow survives into [`the guard`](../src/tui/state.ts:706).                                                                                               |
| 4   | **Obsolete** | The tree is committed as `25b85cb`, `e8bac1a`, `cf327bf`, `fc96ce5`, `99d293d`. The TUI work landed as one commit rather than the suggested two; nothing to do.                                                                                                                                                            |

### Phase 1 — close the cross-run trust-gate bypass (1.1)

The only finding that lets remote-authored config reach a destination with no prompt. Do this first
and alone.

1. `runBuild` writes a provenance record next to its output — `generated/.ulis-provenance.json`,
   `{ version: 1, remoteSources: string[] }` — whenever any resolved preset has a `remoteUrl`. Write
   it on every build, so a purely local rebuild _removes_ a stale record rather than leaving it.
2. `runInstall` reads that record when it is not rebuilding, and folds the URLs into `remoteSources`.
3. When the record is non-empty and the install cannot re-resolve those presets (the clones are gone
   by then), **refuse**: `--skip-rebuild` errors with "this generated tree was built from <url>;
   re-run `ulis install --preset <url>` so the commands can be reviewed against a fresh build."
   Recommended over arming the gate on the on-disk bytes, which would need a second preview path
   reading artifacts from disk — exactly the divergence the [`rebuild` decision](../src/install.ts:284)
   exists to prevent. Rejecting `build --preset <url>` outright is cheaper still but removes a
   legitimate preview use; take it only if step 1–3 turns out to cost more than ~50 lines.
4. Redact userinfo in the recorded URL (`redactUserinfo`) — the record lands in a source tree a user
   may commit.
5. Tests, in `src/install.test.ts`: `build --preset <remote>` then `install --skip-rebuild` refuses;
   a local rebuild clears a previously written record; `install --preset <remote>` still gates
   normally; a purely local build writes no record and prompts for nothing.
6. Document the record in `docs/SPEC.md` and `docs/guide/remote-sources.md`, and note it in
   `CONTEXT.md` as install-time state.

Ship this before any release.

### Phase 2 — identity instead of naming (1.2, 1.3)

Depends on nothing; do it alongside Phase 1 if convenient, but keep it a separate commit.

1. [`actions.ts:202`](../src/tui/actions.ts:202): pass `sourceIsRemote: planned.remote`. Not `true` —
   the enclosing branch also fires for a presets-only `remoteRef` over a local base source, and
   `true` there would wrongly drop that local source's `.env`.
2. Delete [`isClonedSourceDir`](../src/install.ts:215) and the `REMOTE_CLONE_DIRNAME_PREFIX` import if
   it becomes unused; `sourceIsRemote` is then the only input. Update the comment block above
   `loadDotEnv`'s call site, which currently explains the heuristic.
3. Tests: a TUI install of a remote source skips the source `.env`; a TUI presets-only install over a
   local source still reads it; a local source directory literally named `ulis-remote-foo` now reads
   its `.env` (the false positive 1.3 described).

### Phase 3 — 0.7.1 patch release (2.2)

Blocked on Phases 1 and 2: publishing the gate rewrite while the cross-run bypass is open would ship
a fix that is itself bypassable.

1. Confirm `develop` carries: gate above every write, enumeration of what generators _emit_, and the
   no-TTY throw (all three present at `99d293d`).
2. Land Phases 1, 2 and 4 on `develop`, merge to `master`, bump to `0.7.1`, tag, publish.
3. `CHANGELOG` entry naming the bypass classes fixed, so a 0.7.0 user can judge their exposure.

### Phase 4 — documentation and artifact drift (2.1, 2.3)

Cheap, independent, and required before the release in Phase 3.

1. [`remote-url-sources.md:211`](remote-url-sources.md) — replace "Declining skips extensions and
   external skills but **still installs the generated config files**" with the shipped rule: the gate
   sits above every write and declining installs nothing.
2. [`remote-url-sources.md:322`](remote-url-sources.md) — the §4.1 test row "generated config files
   still written" becomes "nothing written", matching [`install.test.ts:2242`](../src/install.test.ts:2242).
3. Regenerate `tui.svg` with `bun run gen:screenshot` and commit it.
4. Consider a CI check that fails when a regenerated `tui.svg` differs from the committed one; the
   file has now drifted once unnoticed.

### Phase 5 — hardening and copy (3.1, 3.2, 3.4, 3.5, 3.6)

No release pressure. One commit is fine.

1. **3.4** — in [`install.ts:183`](../src/install.ts:183), drop the `requireTty: true` argument and
   keep the explicit throw; it carries the actionable message. Test: no TTY → throws, not `false`.
2. **3.2** — add to `src/tui/state.test.ts`, per flow:
   `expect(new Set(items.map((i) => i.id)).size).toBe(items.length)`.
3. **3.1** — `value !== undefined` at [`view.ts:168`](../src/tui/view.ts:168). Hardening only; no
   behaviour changes today.
4. **3.6** — restore the urgency in [`view.ts:420`](../src/tui/view.ts:420) and drop "execution
   surface": e.g. "<source> contributes the commands below. Some run during the install, the rest are
   installed now and run later by the agent." Update the `view.test.ts` snapshot and regenerate
   `tui.svg` if the review screen is in frame.
5. **3.5** — comment above [`previewInstalledExecution`](../src/install/preview.ts:79) stating the
   second generate pass is deliberate: the preview regenerates _in memory_ from the same inputs so
   that what is shown is what `generate()` produces, never what a `generated/` tree on disk happens
   to hold. Do not describe it as "reading the build's bytes back" — it does not.

### Not doing

- **3.3** (`satisfies readonly PlanItem[]`) — no consumer of the literal types exists. Revisit if a
  type-level flow assertion is ever written.
- **3.7** (cursor guard) — the guard is load-bearing for non-navigation keys after a flow change.
  Add a one-line comment saying so if it keeps drawing review attention.
- **§4** (packaging) — done.
