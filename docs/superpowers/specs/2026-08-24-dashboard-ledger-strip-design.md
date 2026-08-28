# Ledger Strip — Dashboard Overview Redesign Spec

Concept mockup: published as a Claude Artifact ("Ledger Strip"), approved by
the user on 2026-08-24.
This document captures the design decisions and, critically, where the real
implementation deviates from the mockup once it met the app's actual data and
components. (The task-by-task implementation plan it was paired with has been
removed now that the work is in code; recover it from git history if needed.)

## What this is

A new hero element on the dashboard Overview screen: a horizontal
"statement register" showing the current month's posted transactions, in
chronological order, each one a small tick against a baseline, ending in the
account's current balance.
It sits above the existing widget grid (Budget, Net worth, Goals, Spending vs
last month, Recent transactions, Recurring, Investments), which keeps its
current visual treatment unchanged.

## Design decisions carried from the mockup

- **Token reuse, zero new colors.**
  The mockup's palette was FundFlow's real tokens already (`--background`,
  `--panel`, `--accent`, the 7-hue `--viz-*` set).
  The real implementation introduces no new CSS custom properties.
- **Mono for labels, proportional sans for money.**
  Ledger dates/eyebrows use `font-mono` (already wired to Geist Mono via
  `--font-mono`); money figures use `<Money>`/`.metric-value` (Geist Sans,
  tabular).
  No new font is loaded — the mockup's Google Fonts substitution (Onest +
  Space Mono, used because the real Geist family isn't on Google Fonts) does
  not apply to the real app, which already has Geist Sans/Mono loaded.
- **Inflow/outflow color.**
  Ticks use `var(--viz-pos)` / `var(--viz-neg)` — the diverging pair
  `docs/PALETTE.md` documents as reserved for exactly this "money in vs money
  out" purpose, confirmed in `app/globals.css` (`--viz-pos: #2a78d6;
  /* diverging pole: inflow */`, `--viz-neg: #e34948; /* diverging pole:
  outflow */`).
- **Signature element, spent in one place.**
  Per the "spend your boldness in one place" principle, the register
  treatment is confined to the new Ledger Strip and to the existing Recent
  Transactions list (which is already, literally, a transaction list — the
  lowest-risk place to extend the motif).
  The other five widgets are not reskinned.

## Deviations from the mockup, and why

1. **"Spending vs last month" keeps its real chart, not a category donut.**
   The mockup showed a 7-category donut (PFC categories, with the
   "fold to Other at 7 slots" rule demonstrated).
   The actual widget (`SpendingCompareWidget` →
   `components/charts/CumulativeCompareChart.tsx`) is a **cumulative
   day-by-day spend comparison** (this month vs. last month), which is a
   different and more informative measure for "vs last month" than a
   category breakdown.
   Swapping in a category donut would be a data/behavior change dressed as a
   visual one.
   This plan does not touch that widget at all — no restyle, no data change.
2. **No masthead/greeting change.**
   The mockup's "Statement · Aug 1–24 · Demo Checking •0001" line sat above
   the greeting.
   The real `PageHeader` component's doc comment explicitly states pages
   "never carry a kicker" by design ("anything load-bearing that used to
   live in a description moves to section copy or a tooltip instead") — an
   app-wide rule, not a dashboard-specific one.
   Rather than override that for one page, the statement framing (month
   label + account name) lives entirely inside the new `LedgerStrip`
   component's own header, which needs no changes to `PageHeader` or the
   greeting logic in `app/dashboard/page.tsx`.
3. **Single anchor account, not a household-wide ledger.**
   Reconstructing a correct running balance across multiple accounts
   (transfers, credit cards, multiple owners) is a materially different and
   much riskier problem than a single account's register, and CLAUDE.md is
   explicit that money correctness takes priority over scope.
   V1 anchors to the first account with `type === "depository"` (checking or
   savings) and its own transactions only, regardless of the page's
   mine/household toggle — mirroring the mockup's own framing, which also
   showed one account ("Demo Checking •0001").
   If no depository account exists, the Ledger Strip does not render.
4. **Which ticks get a permanent label.**
   The mockup hand-picked which ticks were "major" (always-labeled) vs.
   "minor" (label on hover/focus only).
   The real component needs a rule that scales to real transaction volume: a
   tick is major if it's an inflow (income) or its absolute amount is at
   least $100 (`MAJOR_TICK_THRESHOLD` in `lib/ledger-strip.ts`).
   This is a new, ledger-strip-specific constant — deliberately **not**
   reusing `SpendingAnomalyInput.largeTransactionThreshold` from
   `lib/planning.ts`, since anomaly detection and "worth a permanent label on
   a register" are different concerns with no reason to share a threshold
   value.
5. **No page-load draw-in animation.**
   The mockup's ticks grew in on load via a CSS keyframe.
   The real component drops this: it adds motion-reduction-guard surface
   area for a purely decorative effect, and the hover/focus label reveal (a
   ~0.12s opacity fade, consistent with `Button`'s existing
   `transition-all duration-150`, which this codebase does not gate behind
   `prefers-reduced-motion` either) is the interaction that actually matters.
   Can be revisited as a follow-up if wanted.
6. **A pre-existing privacy-blur gap gets fixed in passing.**
   `BudgetWidget.tsx` renders `spent`/`monthlyLimit` via a bare
   `formatCurrency()` call with no `.money`, `.metric-value`, or `data-money`
   hook — meaning that figure does not respect the privacy-blur toggle,
   unlike every other widget's money figures.
   This is a real, narrow bug (not a stylistic choice), so this plan fixes
   it as part of the same body of work, per this repo's "fix it when you see
   it" convention for engineering-quality issues.
   It is a one-attribute change (`data-money` on the existing `<span>`), not
   a restyle of the widget.

## Non-goals

- No new design tokens, no new fonts, no changes to `docs/PALETTE.md` or
  `scripts/validate_palette.js`.
- No changes to `Panel`, `Button`, `Badge`, or any other shared `components/ui/`
  primitive.
- No changes to the `WIDGET_KEYS` registry, `dashboard_prefs` schema, or the
  Customize drawer — the Ledger Strip is not user-hideable or reorderable.
- No restyle of Budget, Net worth, Goals, Spending vs last month, Recurring,
  or Investments beyond the one-line `BudgetWidget` privacy-blur fix above.
