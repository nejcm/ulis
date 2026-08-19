# Interrupt guard owns resolver cleanup

Status: approved, not started
Design date: 2026-08-18
Origin: architecture review candidate #1, re-shaped after external triage
Related: [ADR 0003 — Remote Sources via git clone](../docs/adr/0003-remote-sources-via-git-clone.md)

---

## 1. Context

Both resolvers hand their disposal back to the caller:

- [`resolveSourceOrRemote`](../src/utils/resolve-source.ts) (`resolve-source.ts:77`) → `ResolvedSource & { cleanup: () => void }`
- [`resolvePresets`](../src/utils/resolve-presets.ts) (`resolve-presets.ts:112`) → `{ presets, cleanup }`

Every CLI caller must therefore pair `guard.track(...)` with `guard.onCleanup(result.cleanup)` by hand.
Four pairs across three commands:

| Site | Lines |
|------|-------|
| [`src/commands/build.ts`](../src/commands/build.ts) | 40–43 |
| [`src/commands/install.ts`](../src/commands/install.ts) | 35–45 (source), 51–58 (presets) |
| [`src/commands/preset.ts`](../src/commands/preset.ts) | 71–80 |

Forgetting the second half strands a temp clone that may carry credentials from the URL. **This is a
discipline hazard, not a live bug** — all four existing call sites register correctly, and the tests
cover them. But the invariant "a resolved clone is always registered for disposal" currently lives in
the callers rather than in the guard, so it has to be re-established by hand at every new call site.

`createInterruptGuard` ([`src/utils/interrupt.ts:25`](../src/utils/interrupt.ts)) already owns the
`cleanups` array, the `inFlight` counter, and the deferred-exit logic. It is one operation short of
owning the whole contract.

**Goal:** make it impossible to resolve a clone without registering its disposal, without moving anything
in the consent flow.

**Not in scope:** a `withRunInput(spec, fn)` callback scope. The TUI's prepared clone deliberately
survives from the review screen to the install that follows — `preparedRemote.cleanup` is held across
event boundaries in [`src/tui/controller.ts:267–358`](../src/tui/controller.ts), and
`disposePreparedRemote` runs on supersede or shutdown, not on scope exit. A callback scope cannot express
that without either changing the consent flow ADR 0003 depends on, or re-exposing disposal anyway.
`src/tui/actions.ts` and `src/tui/controller.ts` are untouched by this plan, on purpose.

## 2. Decisions

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | Shape | One extra operation on the existing `InterruptGuard` | No new module; the guard already owns the cleanup list |
| 2 | Constraint | `T extends { readonly cleanup: () => void }` | Both resolvers already satisfy it; nothing else has to change |
| 3 | Registration order | Register cleanup *after* `work()` resolves, before returning | Nothing exists to clean up until it resolves; a throw inside is handled by the resolver's own unwind |
| 4 | `track`/`onCleanup` | Keep both public | The TUI does not use the guard, but keeping the primitives avoids forcing every future caller through one shape |
| 5 | Scope | CLI commands only | TUI ownership stays explicit (§1) |

## 3. Implementation

### 3.1 `src/utils/interrupt.ts`

Add to the `InterruptGuard` interface:

```ts
/**
 * Track a resolver and register the cleanup it returns, so a clone can never be resolved without
 * being registered for disposal. Equivalent to `track` followed by `onCleanup`, minus the chance
 * of forgetting the second half.
 */
resolve<T extends { readonly cleanup: () => void }>(work: () => Promise<T>): Promise<T>;
```

And to the object returned by `createInterruptGuard`, reusing the existing `track` and `cleanups`:

```ts
async resolve(work) {
  const result = await this.track(work);
  cleanups.push(result.cleanup);
  return result;
}
```

Push directly onto `cleanups` rather than calling `this.onCleanup` — `cleanups` is already in scope, so the
indirection buys nothing. (`this` would in fact resolve fine: it is bound at call time, not when the object
literal is constructed. The reason to avoid `this` here is that a caller who destructures the guard loses
it, not that it is unbound.)

### 3.2 Call sites

Each pair collapses to one statement:

```ts
// src/commands/build.ts:40-43
const { presets } = await guard.resolve(() =>
  resolvePresets(presetNames, { nonInteractive, logger: log, signal: guard.signal }),
);
```

```ts
// src/commands/install.ts:35-45
const resolved = await guard.resolve(() =>
  resolveSourceOrRemote({ global: options.global, homeDir: options.homeDir, source: options.source, logger: log, signal: guard.signal }),
);
const { sourceDir, destBase, mode } = resolved;
```

`installCmd` keeps reading `resolved.sourceDir` / `resolved.mode` exactly as now; only the
`guard.onCleanup(...)` line disappears. Same for `install.ts:51-58` and `preset.ts:71-80`.

After the change, `onCleanup` has no callers in `src/commands/`. Keep it exported (decision #4).

### 3.3 Tests

[`src/commands/commands.test.ts`](../src/commands/commands.test.ts) already covers the interrupt paths —
the `halts` fixture (~line 84), the "handler must not outlive the command" assertion (~line 235), and the
deferred-exit-after-clone-removal case (~line 290). Those should pass unchanged; if any fails, the
registration order in §3.1 is wrong.

**New test:** a resolver that succeeds and is then followed by a throw — the shape that regresses if
`resolve` registers cleanup on the wrong side of the `await` — must still have its temp directory removed
by `release()`. Assert on directory absence, not on a spy call count.

## 4. QA

### 4.1 Automated

```bash
bun run lint
bun test src/commands src/utils
```

### 4.2 Manual leak check

Needs a real remote source; watch the temp root (`%TEMP%` / `$TMPDIR`) for `ulis-` directories throughout.

```bash
bun run ulis install --source https://github.com/<user>/<repo> --yes
```

1. Full run to completion → no `ulis-` directory survives.
2. Second run, Ctrl-C **during** the clone → the abort unwinds, the exit is deferred, no directory survives.
3. Third run, Ctrl-C **after** the clone but during install → cleanup runs from `release()`, no directory survives.
4. A purely local run (`bun run ulis install`) registers no signal handlers — confirms the guard's inactive
   path is untouched. It may still prompt: a local install whose destination directories already exist asks
   for overwrite confirmation unless `-y` is passed (`src/commands/install.ts`). Only the trust gate is
   remote-only.

### 4.3 Exit checks

```bash
bun run lint && bun run test
```

## 5. Rollback

Additive and behaviour-preserving: `resolve` is a new operation, `track` and `onCleanup` keep working.
Reverting means inlining the four call sites back to the two-line form and deleting the operation. No
persisted state, no change to the trust gate, the Ownership Manifest, or Preserved Native Config.
