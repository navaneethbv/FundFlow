# FundFlow frontend review — implementation plan

Date: 2026-09-01 · Branch: `fix/frontend-review-2026-08-31` ·
Companions: [SPEC](./FRONTEND-REVIEW-2026-09-SPEC.md) · [DESIGN](./FRONTEND-REVIEW-2026-09-DESIGN.md)

Every step is TDD: the named test file is written (or extended) first, confirmed
failing, then the implementation lands. Test conventions follow the repo's established
patterns:

- **Source-level wiring tests** (`readFileSync` + assertions) for client-only
  interaction — the `tests/unit/command-palette.test.ts` convention.
- **Render tests** (`createElement` + `renderToStaticMarkup`) for anything
  server-renderable — the `tests/unit/accounts-page-render.test.ts` convention.
- Flat `tests/unit/<feature>-<topic>.test.ts` naming; no jsdom, no testing-library.

## Work order

### Step 1 — Skip link (R5)

Test first: `tests/unit/skip-link.test.ts` — asserts `app/layout.tsx` renders a skip
link as the first body child targeting `#main-content`; `AppShell.tsx` and
`AuthShell.tsx` carry `id="main-content"` and `tabIndex={-1}`.

Implement: layout link (sr-only until focus, accent pill), both `<main>` targets.

### Step 2 — Root error boundary (R1)

Test first: `tests/unit/root-error-boundary.test.ts` — source test: `app/error.tsx`
exists, is `"use client"`, calls `reset()`, contains the data-unchanged reassurance;
scan test: every route directory with a `page.tsx` that throws is out of scope, but
`app/error.tsx` must exist.

Implement: `app/error.tsx` in the `budget/error.tsx` register.

### Step 3 — Metadata (R2)

Test first: extend/scan in `tests/unit/route-metadata.test.ts` — every
`app/**/page.tsx` (excluding `app/page.tsx`) contains `export const metadata` with a
non-empty `title`; layout declares the `%s — FundFlow` template.

Implement: layout template + per-route `export const metadata`.

### Step 4 — Shell-stable skeletons (R3)

Test first: `tests/unit/route-skeleton.test.ts` — `RouteSkeleton` renders `AppShell`
with the passed `active`; a scan asserts `loading.tsx` exists for `transactions`,
`dashboard`, `reports`, `accounts`, `wrapped`, `settings`, `budget`, `recurring`,
`cash-flow`, and that each renders `RouteSkeleton` (no bare skeleton without shell).

Implement: `components/shell/RouteSkeleton.tsx` + nine `loading.tsx` files.

### Step 5 — Dialog focus hook (R4a)

Test first: `tests/unit/dialog-focus.test.ts` — source test on `lib/use-dialog-focus.ts`:
`FOCUSABLE` is exported and includes `a[href]`, `textarea:not([disabled])`,
`[tabindex]:not([tabindex="-1"])`, plus the original controls; Escape + Tab handling
present.

Implement: hook change. All existing usages keep compiling (API unchanged).

### Step 6 — Modal adoption (R4b)

Test first: `tests/unit/modal-dialog-discipline.test.ts` — scan test asserting
`AddTransactionModal`, `TransactionEditor`, `AddManualHoldingForm` each contain
`<dialog`, `aria-modal`, `aria-labelledby`, and `useDialogFocus`; global scan: no
`fixed inset-0` overlay renders a bare `<form>`/`<div>` panel without `<dialog`.

Implement: convert the three modals to the `CustomizeDrawer` recipe (`aria-labelledby`
pointing at their heading ids).

### Step 7 — Command palette combobox (R6)

Test first: extend `tests/unit/command-palette.test.ts` — input carries
`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`;
`role="option"` list items contain no `<button>`; `aria-selected` present;
`useDialogFocus` wired; Escape handled by the hook rather than duplicated globally.

Implement: restructure the list, option ids, Tab trap.

### Step 8 — Popover semantics + focus return (R7)

Test first: `tests/unit/popover-semantics.test.ts` — render/source tests:
`UserMenu`, `DropdownButton`, `GoalCardMenu` (and `BudgetTable`/`RecurringList` row
menus if they carry mixed children) contain no `role="menu"`/`role="menuitem"` /
`aria-haspopup="menu"`; each trigger restores focus on close (source assert on the
trigger-ref pattern from `TransactionSortMenu`).

Implement: drop menu roles, keep `aria-expanded`, add focus return.

### Step 9 — Field aria chain + input focus ring (R8)

Test first: `tests/unit/field-aria.test.ts` — render `Field` with an error and a
control child: error `<p>` has `id="${htmlFor}-error"` and `role="alert"`; the child
gains `aria-invalid="true"` and `aria-describedby` pointing at it; hint renders
without error styling when no error. `fieldClasses` no longer contains
`focus:outline-none` and contains `focus:outline-2`.

Implement: `Field.tsx` (id derivation + `cloneElement` injection, guarded),
`Input.tsx` `fieldClasses`.

### Step 10 — Token migration (R9)

Test first: `tests/unit/no-hardcoded-palette.test.ts` — scan `components/**` and
`app/**` for `(text|bg|border)-(red|green|amber|emerald|blue|orange|yellow|rose|lime|sky)-\d`
literals; fails listing offending files. Also render-assert `Panel`'s warning tone
uses `--warning` classes.

Implement: replace per file, preserving intent; `Panel.tsx` warning tone →
`border-warning/35 bg-warning/10` (matching the danger/success recipe). Run
`npm run validate:palette`.

### Step 11 — Local date anchoring (R10)

Test first: extend `tests/unit/format-date.test.ts` (or a new scan test) —
`components/**` must not contain `toISOString().slice(0, 10)`; both modal sources
reference `localDateKey`.

Implement: swap in `localDateKey()`.

### Step 12 — Small semantics (R11, R12)

Test first: `tests/unit/small-semantics.test.ts` — `SegmentedControl` uses
`aria-current="true"`; `StatTile` glyphs are `aria-hidden`; `TrendChart`,
`DivergingColumns`, `CumulativeCompareChart` twin tables sit inside
`overflow-x-auto`; `SectionHeading.tsx` no longer exists.

Implement: the three fixes + deletion.

### Step 13 — searchParams convergence (R13)

Test first: source scan that `dashboard`, `review`, `wrapped`, `settings` pages
reference `firstSearchParam` and type `string | string[]`.

Implement: normalize via `lib/search-params.ts`.

### Step 14 — Dependency freshness (R14)

`next` + `eslint-config-next` 16.3.3 → 16.3.4 (patch). Run the full gate after.

## Gates (final)

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run validate:palette`
4. `npm run test:unit`
5. `npm run build`
6. `graphify update .` (repo rule after code changes; output is gitignored)

`visual-baseline.spec.ts` will diff on routes touched by R9 tone corrections and R3
skeleton additions; baselines are **not** regenerated on this branch without operator
review of the intended diffs (same rule the F10 remediation followed).

## Risk register

| Risk | Mitigation |
|---|---|
| `cloneElement` in `Field` throws on non-element children | Guard with `isValidElement`; fall back to unassociated `role="alert"` error |
| Existing render tests assert on removed classes (`focus:outline-none`, menu roles) | Run full unit suite per step; update assertions only where the spec mandates the change |
| Token migration shifts tones | Validate with `validate:palette`; note expected visual diffs for baseline review |
| Metadata scan trips on redirect/login pages | Scan excludes `app/page.tsx` (redirect) and documents the exclusion |
| `useDialogFocus` selector change alters tab order in the two existing dialogs | Their content is audited: `CustomizeDrawer` has no links/textarea; `SeedBudgetButton` is a single form — no behavior change |
