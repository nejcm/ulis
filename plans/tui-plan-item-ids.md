# Stable identity for TUI plan items

Status: implemented and reviewed (`src/tui/state.ts`, `src/tui/view.ts`)
Design date: 2026-08-18
Origin: architecture review candidate #3, narrowed after external triage

---

## 1. Context

The plan screen's rows are two arrays of display strings
([`src/tui/state.ts:130`](../src/tui/state.ts)):

```ts
export const DASHBOARD_ITEMS = ["Preset layers", "Base source", ... ] as const;
const DASHBOARD_BREAKS = [3, 7, 10];
```

Those literals carry four different jobs at once: **identity**, **display text**, **row order**, and —
via a parallel array of integers — **separator position**. Three modules read them:

| Site                                                      | What it does with the label                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`handlePlanKey`](../src/tui/state.ts) (`state.ts:674`)   | branches on the string to decide toggles and navigation                                                             |
| [`planItemValue`](../src/tui/view.ts) (`view.ts:182`)     | branches on the string to render the row's value, using `value === label` as a sentinel for "this row has no value" |
| [`planItemCursor`](../src/tui/state.ts) (`state.ts:1045`) | looks a row up by label; 4 call sites, all passing `"Install"`                                                      |
| [`planItemsBreaks`](../src/tui/state.ts) (`state.ts:459`) | returns hardcoded indices into those arrays                                                                         |

**The concrete defect is the breaks arrays.** Label identity _is_ compiler-checked — `TuiPlanItem` is a
union of the literals, so renaming one fails every `item === "Backup"` comparison. But
`DASHBOARD_BREAKS = [3, 7, 10]` and `PRESET_ONLY_BREAKS = [2, 6, 8]` are raw positional indices with no
type link to the arrays they index. Insert or reorder a row and the visual separators silently move to
the wrong places — no type error, no failing test.

**Goal:** a plan row declares its own id, its own label, and its own trailing break. Adding or reordering
a row requires no arithmetic anywhere.

**Not in scope:** splitting the TUI into one module per screen. That was the original proposal; it would
add twelve modules without removing the coordination that actually hurts.

## 2. Decisions

| #   | Decision        | Choice                                                                                                          | Why                                                                                                    |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Item shape      | `{ id, label, breakAfter? }` records                                                                            | Identity, display, and layout stop sharing one string                                                  |
| 2   | Arrays          | Keep `DASHBOARD_ITEMS` and `PRESET_ONLY_PLAN_ITEMS` separate, keep `planItems(state)` selecting by `state.flow` | That switch is not the problem; a merged array with per-flow filters would be worse                    |
| 3   | Preset row ids  | Both "Preset layers" and "Preset sources" get id `"presets"`                                                    | Collapses the existing `label === "Preset layers" \|\| label === "Preset sources"` double-check        |
| 4   | Breaks          | `breakAfter?: true` on the item; delete both index arrays and `planItemsBreaks`                                 | Removes the only coupling the compiler cannot see                                                      |
| 5   | Value sentinel  | `planItemValue` returns `string \| undefined`                                                                   | Drops the `value === label` trick, which only worked because identity and display were the same string |
| 6   | Preference keys | Unchanged                                                                                                       | `TuiFlowPreferences` keys off state fields, not plan labels — nothing persisted moves                  |

## 3. Implementation

### 3.1 `src/tui/state.ts`

Replace the two `as const` string arrays and the `TuiPlanItem` label union:

```ts
export type PlanItemId =
  | "presets" | "source" | "platforms" | "destination"
  | "presetExtensions" | "skipExternalSkills" | "prune" | "rebuild" | "backup"
  | "validate" | "build" | "install" | "back";

export interface PlanItem {
  readonly id: PlanItemId;
  readonly label: string;
  /** Render a blank row after this item. Replaces the positional BREAKS arrays. */
  readonly breakAfter?: true;
}

export const DASHBOARD_ITEMS: readonly PlanItem[] = [
  { id: "presets", label: "Preset layers" },
  { id: "source", label: "Base source" },
  { id: "platforms", label: "Platforms" },
  { id: "destination", label: "Install destination", breakAfter: true },
  ...
];
```

Transcribe `DASHBOARD_BREAKS = [3, 7, 10]` and `PRESET_ONLY_BREAKS = [2, 6, 8]` into `breakAfter: true`
on the item at each of those indices **before** deleting them — this is the one step where an off-by-one
is invisible to the compiler. Verify against the current rendering, not against the numbers.

Then:

- `handlePlanKey` (`state.ts:674`) — `const item = items[state.cursor]`, branch on `item.id`. Every
  `case "Backup":` becomes `case "backup":`; the `if (item === "Backup" && isToggleKey(key))` guards
  become `if (item.id === "backup" && ...)`.
- `planItemCursor(state, id: PlanItemId)` (`state.ts:1045`) — `planItems(state).findIndex((item) => item.id === id)`.
  Its 4 call sites (`state.ts:621`, `:628`, `:1017`, `:1040`) all pass `"install"`.
- Delete `DASHBOARD_BREAKS`, `PRESET_ONLY_BREAKS`, and `planItemsBreaks`.
- Export `PlanItem` and `PlanItemId`; drop `TuiPlanItem`.

Make the `handlePlanKey` confirm-branch a `switch (item.id)` with no `default`, so a new id that nobody
handled is a type error rather than a silently dead row.

### 3.2 `src/tui/view.ts`

`planView` (`view.ts:164`) drops the breaks lookup:

```ts
const actions: ViewRow[] = planItems(state).flatMap((item, index) => {
  const value = planItemValue(state, item);
  const row = option(state, index, item.label, value ? { value } : {});
  return item.breakAfter ? [row, { kind: "blank" } as ViewRow] : [row];
});
```

`planItemValue(state, item: PlanItem): string | undefined` (`view.ts:182`) switches on `item.id` and
returns `undefined` for rows with no value, replacing the `return label` sentinel. The preset branch
collapses to a single `case "presets":`.

### 3.3 Tests

[`src/tui/state.test.ts`](../src/tui/state.test.ts) has 10 sites of the form
`planItems(state).indexOf("Install")` (lines 92, 108, 124, 222, 226, 446, 488, 502, 924, plus a
`not.toContain("Build only")` at 215). Add one helper at the top of the file and use it throughout:

```ts
const planCursor = (state: TuiState, id: PlanItemId) => planItems(state).findIndex((item) => item.id === id);
```

The `not.toContain` assertion becomes an id check on the mapped list.

[`src/tui/view.test.ts`](../src/tui/view.test.ts) assertions read rendered labels, so most should pass
untouched — treat any that break as a signal the transcription in §3.1 is wrong.

**New test** (the regression the change exists to prevent): assert that a plan item carrying
`breakAfter` produces a blank row directly after it, for both flows. This is what the index arrays could
not guarantee.

## 4. QA

### 4.1 Automated

```bash
bun run lint
bun test src/tui
```

`tsc --noEmit` is doing real work here — but only because the `switch (item.id)` ends in a
`assertNeverPlanItemId(item.id)` call taking a `never`. A `default`-less switch alone does not fail the
build on an unhandled row; the `never` parameter is what turns a missed id into a type error.

### 4.2 Manual

```bash
bun run tui
```

Walk every flow — Update this project, Update global configs, Use custom source, Install presets only —
and check:

- separators sit in exactly the same places as before the change (this is the whole point),
- each toggle row (Backup, Prune, Use latest build output, Run preset extensions, Skip external skills)
  still flips with both the toggle key and confirm,
- Back from the install review screen lands the cursor on the Install row, in both the normal and
  presets-only plans,
- row values (`2 selected`, `on`/`off`, source mode) render as before.

Then regenerate and diff the captured frame for unintended layout drift:

```bash
bun run gen:screenshot
```

### 4.3 Exit checks

```bash
bun run lint && bun run test
```

## 5. Rollback

Self-contained and behaviour-preserving. Reverting is a single `git revert`; nothing persisted to disk
(TUI preferences, manifests, generated output) changes shape, so a downgrade needs no migration.
