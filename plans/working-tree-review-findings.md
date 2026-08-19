# Working-tree review findings

Status: open — nothing here is fixed yet
Review date: 2026-08-19
Scope: the uncommitted working tree on `develop` (46 files, +1700/-326) validated against
[`plans/tui-plan-item-ids.md`](tui-plan-item-ids.md) and [`plans/remote-url-sources.md`](remote-url-sources.md)
Baseline: `a31fc19` (merge of `master` into `develop`, 2026-08-19 12:43)

Both plans are implemented correctly. `bun run lint` is clean and `bun test` is 666 pass / 0 fail.
Everything below is a follow-up, ordered by whether it can hurt someone.

---

## 1. Security and correctness

### 1.1 Gate bypass: `build --preset <url>` then `install --skip-rebuild`

`buildCmd` accepts remote *presets* ([`src/commands/build.ts:37`](../src/commands/build.ts)) and writes their
merged output into the local source's `generated/`. A later `ulis install --skip-rebuild` has an empty
`remoteSources`, so the trust gate never fires and the remote-authored MCP servers, hooks and `raw/`
fragments install with no prompt.

This is the same divergence that decision "a remote source cannot skip the build"
([`src/install.ts:278`](../src/install.ts)) closes *within* one run — it is still open *across* runs.

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

The released `master` (`56a2ef4`) gates *after* the config files are written, enumerates what a source
*declares* rather than what a generator *emits*, and silently declines when there is no TTY. If anyone is
using remote sources on 0.7.0, this is patch-release material rather than merge-only material.

### 2.3 `tui.svg` is stale on this branch

Regenerating with `bun run gen:screenshot` swaps the Summary/Actions pane order versus the committed file.
Not caused by the plan-item change — I generated the frame from the pre-change `state.ts`/`view.ts` and from
the post-change ones and they are byte-identical — but the checked-in screenshot does not match what the
branch renders. Regenerate before release.

## 3. Nits

| # | Site | Issue | Suggested change |
|---|------|-------|------------------|
| 3.1 | [`src/tui/view.ts:168`](../src/tui/view.ts) | `value ? { value } : {}` is a truthiness test where the type says `string \| undefined`; an empty-string value would silently render as valueless | `value !== undefined` |
| 3.2 | [`src/tui/state.ts:166`](../src/tui/state.ts) | Nothing checks that plan item ids are unique within a flow. A duplicate would make `planItemCursor` land on the first match while the exhaustiveness switch stays happy | One test: `expect(new Set(ids).size).toBe(ids.length)` per flow |
| 3.3 | [`src/tui/state.ts:166`](../src/tui/state.ts) | `readonly PlanItem[]` erases the literal types | `satisfies readonly PlanItem[]`, which would later allow proving at the type level that `"build"` is absent from the presets-only flow |
| 3.4 | [`src/install.ts:179`](../src/install.ts) | The TTY check is duplicated: `defaultRuntimeDependencies.confirm` throws on `!stdin.isTTY`, then calls `confirm(..., { requireTty: true })`, which checks again | Drop one; the explicit throw carries the better message, so keep that one |
| 3.5 | [`src/install/preview.ts:79`](../src/install/preview.ts) | A remote install parses and generates twice — once in `runBuild`, once in the preview that reads the bytes back. Correct by construction, and only remote runs pay it | Add a comment saying the second pass is deliberate, so nobody "optimises" the preview into reusing the build's output |
| 3.6 | [`src/tui/view.ts:420`](../src/tui/view.ts) | The remote review header lost its urgency: `These commands come from X and WILL RUN if you continue` became `X contributes the execution surface below`. Accurate now that not everything listed runs immediately, but "execution surface" is jargon | Fold the warning back into the header; keep the follow-up line that explains the two classes |
| 3.7 | [`src/tui/state.ts:706`](../src/tui/state.ts) | `if (!item) return` is a `noUncheckedIndexedAccess` appeasement; `moveCursor` already clamps the cursor | Leave it, but note it is defensive only |

## 4. Packaging

Nothing has been committed since the 12:43 merge; every changed file has today's mtime. Five workstreams are
stacked in one tree, which is why no single commit-sized story fits any file — `src/tui/state.ts` alone
carries the plan-item refactor *and* the preset-review re-prepare.

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
