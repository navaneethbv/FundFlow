# FundFlow frontend review — spec

Date: 2026-09-01 · Branch: `fix/frontend-review-2026-08-31` · Baseline: `main` @ `19d216b`

Companion documents: [DESIGN](./FRONTEND-REVIEW-2026-09-DESIGN.md) (the "why" behind each
interaction decision) and [PLAN](./FRONTEND-REVIEW-2026-09-PLAN.md) (TDD work order).

## Context

The previous review cycle (F1–F12, `ui-review.md` + `ui-review-remediation.md`) fixed
data correctness, contrast tokens, and a first pass of accessibility. That work is now
fully contained in `main`. This is the next full-repo review. It found no regressions
of F1–F12; everything below is new.

The review covered: all 30 route groups in `app/`, every directory in `components/`,
the token layer (`app/globals.css`, `docs/PALETTE.md`, `scripts/validate_palette.js`),
and the test infrastructure (`tests/`). Conformance was checked against the Next 16
guides in `node_modules/next/dist/docs/` — no Next-16 API violations exist in `main`
(`proxy.ts`, awaited `searchParams`, awaited dynamic APIs are all correct).

## Problem statements and requirements

Each finding has an ID, a requirement, and acceptance criteria. "Milestone 1" items are
implemented on this branch; the rest are specified for follow-up and tracked in the
plan's deferral table.

### R1 — A crash must land in the app, not the framework (HIGH · Milestone 1)

`app/error.tsx` and `app/global-error.tsx` do not exist. Raw Supabase errors thrown by
`app/accounts/page.tsx:161`, `app/debt/page.tsx:48`, and `assertQueryResults` bubble to
Next's default production error page: no nav, no branding, no retry.

**Requirements**

- `app/error.tsx` exists, is a client component, offers "Try again" via `reset()`, and
  states that the user's data was not changed. It reuses the established error-copy
  register (see `app/budget/error.tsx`).
- A source-level gate fails if any `app/**/error.tsx` is later removed.

**Acceptance:** a thrown render error on any route without its own `error.tsx` renders
the in-app boundary with a working retry.

### R2 — Every route titles itself (HIGH · Milestone 1)

Only `app/layout.tsx:17` exports metadata. All ~30 routes share the single title
"FundFlow", which breaks browser history, tab titling, and screen-reader page context.

**Requirements**

- `app/layout.tsx` declares `title: { default: "FundFlow", template: "%s — FundFlow" }`.
- Every route `page.tsx` under `app/` exports static `metadata` with a human page title
  (e.g. "Transactions"), except `app/page.tsx` (redirect) and the root layout.
- A source-level gate fails when a new `app/**/page.tsx` lands without `metadata`.

**Acceptance:** navigating to any signed-in route shows "Page — FundFlow" in the tab;
the scan test passes.

### R3 — Navigation shows progress in the shell (HIGH · Milestone 1)

`loading.tsx` exists only on `budget`, `recurring`, `cash-flow` — the three lightest
routes — and those skeletons render without the `AppShell`, so the sidebar unmounts on
every navigation into them. The heaviest routes (`transactions`, `wrapped`, `settings`,
`dashboard`, `reports`, `accounts`) have no loading state at all.

**Requirements**

- A shared `components/shell/RouteSkeleton.tsx` renders `AppShell` with the route's
  `active` id plus a restrained skeleton surface (register aesthetic: hairline rules,
  panel tones — no spinning loaders).
- `loading.tsx` exists for: `transactions`, `dashboard`, `reports`, `accounts`,
  `wrapped`, `settings`, and the existing three routes are re-wrapped in the shell.
- Skeletons respect `prefers-reduced-motion` (the global kill-switch covers CSS
  animation; the skeleton must not add JS animation).

**Acceptance:** navigating into any covered route keeps the sidebar mounted and shows
the skeleton until the page resolves.

### R4 — One dialog discipline (HIGH · Milestone 1)

`lib/use-dialog-focus.ts` (focus-on-open, Tab trap, Escape) is used by only two of the
~8 modal surfaces. `AddTransactionModal` is a bare overlay `<div>`: no `role="dialog"`,
no Escape, no focus management; the background page stays fully tabbable while
invisible. `TransactionEditor` handles Escape but never traps Tab or moves focus on
open. The hook's `FOCUSABLE` selector misses `a[href]`, `textarea`, and
`[tabindex]`, so even the two "fixed" dialogs leak when they contain links.

**Requirements**

- `FOCUSABLE` is extended and exported: `a[href]`, `textarea:not([disabled])`,
  `[tabindex]:not([tabindex="-1"])` join the existing controls.
- `AddTransactionModal`, `TransactionEditor`, and `AddManualHoldingForm` render a
  `<dialog open aria-modal aria-labelledby>` wired through `useDialogFocus`.
- A source-level gate fails when a `fixed inset-0` overlay appears without `<dialog`.

**Acceptance:** every modal in the app traps Tab, closes on Escape, and moves focus on
open; the overlay-scan test passes.

### R5 — Skip to content (HIGH · Milestone 1)

No skip link exists anywhere; keyboard users tab through the entire sidebar
(~15 links plus utility icons) before content on every page. `AppShell`'s `<main>` has
no id; `AuthShell`'s `<main>` has no id.

**Requirements**

- `app/layout.tsx` renders a "Skip to content" link as the first body child:
  visually hidden until focused, then visible with register styling.
- `AppShell` and `AuthShell` `<main>` elements carry `id="main-content"` and
  `tabIndex={-1}`.
- A source-level gate asserts the link, the target id, and `tabIndex={-1}`.

**Acceptance:** first Tab on any page (signed-in or auth) focuses "Skip to content";
activating it moves focus into `<main>`.

### R6 — Command palette uses real combobox semantics (MEDIUM · Milestone 1)

`CommandPalette.tsx:135-155` puts `role="option"` list items that each contain a
`<button>` inside `role="listbox"` — options must not own interactive descendants.
The palette also has no `aria-activedescendant`, and Tab can leave the modal.

**Requirements**

- The input becomes a combobox (`role="combobox"`, `aria-expanded`,
  `aria-controls`, `aria-activedescendant` pointing at the highlighted option id).
- Options are `role="option"` elements with `aria-selected` and **no focusable
  descendants**; pointer activation remains a click on the option.
- The palette's dialog routes Tab through `useDialogFocus`.

**Acceptance:** axe passes on the open palette; the render test asserts the combobox
contract (no interactive descendants inside the listbox).

### R7 — Popovers stop pretending to be menus (MEDIUM · Milestone 1)

`UserMenu`, `DropdownButton`, `GoalCardMenu`, `BudgetTable`'s row menu, and
`RecurringList`'s row menu use `role="menu"` containing checkboxes, forms, and links —
none are `menuitem`s, so the ARIA contract is invalid. None restore focus to the
trigger on close (contrast: `TransactionSortMenu` does, correctly).

**Requirements**

- Where the content is toggles/rows rather than commands, drop `role="menu"` /
  `role="menuitem"` / `aria-haspopup="menu"` entirely: the popover is a labelled
  disclosure panel; the trigger keeps `aria-expanded`.
- Where the content genuinely is a command list, keep `role="menu"` **only** if every
  child is a `menuitem` and arrow-key navigation works — otherwise drop it.
- All of them restore focus to the trigger on Escape and on close.

**Acceptance:** no `role="menu"` with non-`menuitem` children remains (render/source
tests); Escape from each popover returns focus to its trigger.

### R8 — Field errors are announced and associated (MEDIUM · Milestone 1)

`aria-describedby` and `aria-invalid` have zero occurrences in the codebase. `Field`
renders its error `<p>` with no id and no linkage; async failures across ~15 surfaces
render as unannounced plain text.

**Requirements**

- `Field` gives its error an id derived from `htmlFor` (`${htmlFor}-error`) and, when
  the child is a single control element, injects `aria-invalid` and
  `aria-describedby` onto it via `cloneElement`.
- The error `<p>` carries `role="alert"` so async set-state failures are announced.
- `Input`'s and `Select`'s shared `fieldClasses` drop `focus:outline-none` in favor of
  a visible `focus:outline-2` accent ring (the current 1px border-color-only indicator
  fails WCAG 2.4.7 / 1.4.11).

**Acceptance:** render test asserts the full chain (label → control `aria-describedby`
→ error id + `role="alert"`); `validate:palette` and axe unaffected.

### R9 — Color belongs to tokens (MEDIUM-HIGH · Milestone 1)

Hardcoded Tailwind palette colors (`text-red-600`, `text-green-600`, `text-amber-*`,
`bg-red-*`, …) appear in ~21 component files. They bypass the validated token layer,
most have no `dark:` variant, and none pass the 4.5:1 gate `validate_palette.js`
enforces for the semantic tokens. `Panel`'s `warning` tone is the same defect inside a
primitive (`border-amber-500/35 bg-amber-500/10` while its `danger`/`success` tones
use tokens).

**Requirements**

- All hardcoded Tailwind palette classes in `components/**` and `app/**` are replaced
  by their semantic tokens (`text-danger`, `text-success`, `text-warning`,
  `bg-danger/10`, …), preserving intent (decorative vs. semantic).
- `Panel`'s warning tone uses `--warning` tokens like its siblings.
- A source-level scan gate fails when `text|bg|border-(red|green|amber|emerald|blue|...)-`
  literals reappear (allowlist: none).

**Acceptance:** scan test passes; `npm run validate:palette` passes; visual diffs are
limited to tone fidelity improvements.

### R10 — Client date anchoring uses local time (MEDIUM · Milestone 1)

`AddTransactionModal.tsx:40,125` and `AddManualHoldingForm.tsx:32,148` seed/max their
date inputs with `new Date().toISOString().slice(0,10)` — UTC-anchored, so users west
of UTC get yesterday's date in the evening. The repo already has `localDateKey()`
(`lib/format-date.ts:98`).

**Requirements**

- Both components anchor to `localDateKey()`.
- A source-level gate fails when `toISOString().slice(0, 10)` reappears in
  `components/**` (server-side aggregation elsewhere is out of scope).

**Acceptance:** both forms default to the user's local calendar day.

### R11 — View toggles are not "pages"; glyphs are silent; table twins scroll (LOW · Milestone 1)

- `SegmentedControl` marks view toggles `aria-current="page"`; the relationship is a
  current selection, not a page — use `aria-current="true"`.
- `StatTile` renders `▲`/`▼` as text (announced as "black up-pointing triangle");
  the glyphs are decorative and must be `aria-hidden`.
- The chart table twins in `TrendChart`, `DivergingColumns`, `CumulativeCompareChart`
  are `<table className="w-full">` with no `overflow-x-auto` wrapper — multi-series
  data can overflow 390px (every other table in the app is wrapped).

**Acceptance:** render tests assert all three.

### R12 — Dead code leaves (LOW · Milestone 1)

`components/ui/SectionHeading.tsx` is imported nowhere. Delete it.

### R13 — searchParams typing converges (MEDIUM · Milestone 1)

`dashboard`, `review`, `wrapped`, and `settings` type `searchParams` values as bare
`string`; Next can deliver `string[]`. Seven other routes already normalize via
`lib/search-params.ts` `firstSearchParam`.

**Requirements:** those four pages accept `string | string[]` and normalize through
`firstSearchParam` (or their existing lib parser, as `ledger` does).

### R14 — Dependency freshness (Milestone 1)

`npx npm-check-updates` was run. Applied: `next` and `eslint-config-next` 16.3.3 →
16.3.4 (patch). Skipped, with reasons recorded in the PR description: `eslint` 9→10,
`typescript` 6→7, `plaid` 43→46 (major toolchain/data-layer risk, no review-related
benefit); `lucide-react` 1.33→1.38, `nodemailer` 9.0→9.1 (minor churn unrelated to
this work); major-version-zero bumps (`@anthropic-ai/sdk`, `@supabase/ssr`, `pdfkit`,
`sharp`) with no benefit for this branch.

## Explicitly deferred (specified, not built here)

| ID | Finding | Why deferred |
|---|---|---|
| P1 | Ledger facet scan pages the entire filtered table on every `/transactions` render (`app/transactions/page.tsx:341-359`, `lib/ledger-data.ts:16-31`) | Needs SQL-side facet aggregation design + large-data QA; data-layer work, not frontend-only |
| P2 | `RefundReview`/`DuplicateReview` fetch on mount → client waterfall on the heaviest route | Server-loading them changes the page's data contract; belongs with P1's ledger pass |
| P3 | Dashboard awaits profiles + recent transactions after its main `Promise.all` | Small perf win; fold into the P1/P2 data pass |
| P4 | `goals` page runs the full dashboard loader for two numbers | Same |
| P5 | `shiftMonth` duplicated 3×, `monthBounds` duplicates `lib/date-utils` | Pure refactor; batch with the next data-layer touch |
| P6 | Server-side clock anchors inconsistent (server-local vs UTC across pages) | Needs a product decision on the canonical anchor; no hydration defect |
| P7 | `AutoRefresh`/`RefreshButton` data swaps are unannounced to AT | Small; deliberately held back to keep this PR reviewable |
| P8 | Sub-rem text sizes (`text-[9px]`, `text-[10px]`) in dashboard cards and palette kbd | Legibility + zoom fidelity pass of its own |
| P9 | No axe in the Playwright suite; `@axe-core/playwright` only used by manual QA scripts | Test-infra work; the unit gates added here cover the new surfaces |
| P10 | Coverage thresholds only see a hand-picked component list | Test-infra work |
| P11 | No e2e for signup, transaction CRUD, login-failure paths | Test-infra work |
| P12 | `:root` light block duplicates `:root[data-theme="light"]` in `globals.css` | Cosmetic maintenance; validator reads this file, so consolidation deserves its own careful pass |

## Out of scope / non-goals

- No visual redesign. The statement-register language (PR #134) is the design system;
  this branch enforces it, it does not revise it.
- No new palette slots, no changes to `--viz-*`, no validator-gate changes.
- No data-layer rewrites (P1–P4 keep their own review cycle).
- No baseline regeneration for `visual-baseline.spec.ts` without operator sign-off on
  the intended diffs (R9 shifts some tones deliberately; see the plan's gate section).

## Milestone 1 acceptance summary

1. `npm run lint`, `npm run typecheck`, `npm run validate:palette`, `npm run
   test:unit`, `npm run build` all pass.
2. Every R-item in "Milestone 1" has its named test passing and demonstrably failed
   first (TDD record in the plan).
3. No new axe-detectable violation is introduced (spot check via existing e2e pages).
