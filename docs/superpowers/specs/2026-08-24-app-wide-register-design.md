# App-Wide Register Design — Extending the Ledger Strip Language

This spec extends
`docs/superpowers/specs/2026-08-24-dashboard-ledger-strip-design.md` (the
dashboard-only spec) to the rest of the app.
It does not replace that document — the dashboard spec's deviations and
decisions still stand — it generalizes the same visual language into
house-wide rules and applies them, page by page, honestly: some pages get
the full treatment, some get a light touch, and some get none at all because
they have no financial content to register-ify.

Grounded in a direct read of all 20 `app/**/page.tsx` routes (2026-08-24).
Where a page's internals weren't read in full (noted per page below), this
spec states what's confirmed vs. what a later phase still needs to verify —
it does not guess at code it hasn't seen.

## The house rules (generalized from the dashboard spec)

1. **Mono for labels, dates, and eyebrows. Proportional sans for money.**
   `font-mono` (→ Geist Mono) never touches a money figure; `<Money>` /
   `.metric-value` (Geist Sans, tabular) never touches a date or a label.
   This is the dashboard's rule, restated as an app-wide one.
2. **`--viz-pos` / `--viz-neg` are the money-direction colors, not
   `--success` / `--danger`.**
   The dashboard spec already established this for the Ledger Strip;
   `components/cash-flow/BreakdownBars.tsx` and
   `components/charts/DivergingColumns.tsx` already independently adopted
   it.
   Any place in the app currently coloring an inflow/outflow with
   `text-success` / `text-danger` (a status-semantic color, not a
   money-direction one) is a convention drift to fix, not a pattern to
   copy forward.
3. **A chronological list of money movements is a register: zebra-striped
   rows, mono date, direction-colored amount.**
   Confirmed via survey: this pattern does not exist as a shared component
   today.
   `RecentActivity` (dashboard), the transactions page's `LedgerTableRow`,
   `ReportTransactions`, `RecurringList`, and `HoldingsTable` are five
   separate, bespoke implementations of the same idea.
   That's real, already-present duplication (not speculative) — Phase 0
   below extracts a shared `RegisterRow` primitive instead of adding a
   sixth bespoke restyle.
4. **Restraint means skipping pages that don't fit, not touching every
   page equally.**
   The dashboard spec's "spend your boldness in one place" principle still
   holds; it now reads as "apply the register motif everywhere there's
   real ledger-like content, and explicitly skip it everywhere there
   isn't" rather than "confine it to one page." Forcing a register motif
   onto a login form or a checklist page would be decoration, not design.

## Decisions this spec makes now

- **`app/accounts/page.tsx` currently inverts rule 1** —
  `AccountRow.tsx`, `SummaryPanel.tsx`, `NetWorthHero.tsx`, and
  `AccountGroup.tsx` all set `font-mono` on the money figures themselves,
  not on labels.
  This predates the dashboard motif and is a real inconsistency, not a
  deliberate alternate style.
  Going forward, the dashboard's convention (rule 1 above) is the house
  standard; Accounts gets remapped to match in its own phase (Phase 7).
- **`RecentActivity`'s existing `text-success` / default-foreground
  inflow/outflow coloring is superseded by rule 2.**
  It gets migrated to `--viz-pos` / `--viz-neg` as part of adopting the new
  shared `RegisterRow` primitive (Phase 0), not left as a second
  color convention alongside the new one.
- **A shared `components/ui/RegisterRow.tsx` primitive is built once
  (Phase 0)** and adopted by every page that has a genuine chronological
  money list, rather than each page reimplementing zebra/mono/direction
  styling independently.
- **Transactions (Phase 1) fully adopts `--viz-pos`/`--viz-neg`, including
  coloring debits red** — a deliberate, explicit override of an existing,
  tested design decision. `tests/unit/mobile-ledger-list.test.ts` (before
  Phase 1) asserted "Monarch does not color debits red": credits got
  `text-success`, debits stayed plain `text-foreground`. The user was told
  this directly and chose full symmetric adoption over preserving that
  restraint. Phase 1's plan rewrites the test that encoded the old
  behavior rather than leaving a contradiction between code and test
  intent. If a later phase reaches a page with the same
  credit-green/debit-plain pattern, this decision — not the original
  Monarch-derived restraint — is the one to follow, unless the user says
  otherwise for that page specifically.

## Phase 6 (Accounts) sign-off

Before `docs/superpowers/plans/2026-08-24-accounts-register.md` was written, research
produced an exact before/after (every money figure that would move from `font-mono`
to proportional sans, and the one table where date/currency columns would move the
other way, into mono) and presented it to the user directly, since it changes the
look of an already-shipped page rather than closing a gap.
The user confirmed the **full remap** over the narrower "money only, skip the
table's date/currency mono" option and over skipping the phase.
`AccountGroup`'s and `NetWorthHero`'s existing `text-success`/`text-danger`
month-change coloring was explicitly kept out of scope for that plan — it already
reads correctly (green/red by sign) and recoloring it to `--viz-pos`/`--viz-neg`
was not part of what was shown to or confirmed by the user.

## Phase 7/8/9 decisions (Review, Wrapped, Budget, Debt, Receipts, Notifications, Settings)

Deep research (not the original page-by-page survey, which never read these pages'
internals) found two places where rule 2 could plausibly apply but the fit was
genuinely ambiguous — a derived status/comparison figure, not a literal
inflow/outflow. Both were put to the user directly rather than decided by guess:

- **Budget's "remaining" figures (`BudgetTable`, `BudgetPlanner`'s `TotalsRow` and
  right rail, and the identically-shaped block on the Review page) and Debt's
  balance/interest figures** are a budget-vs-limit or debt-payoff comparison, not a
  transaction's money direction. The user chose to **convert them to
  `--viz-pos`/`--viz-neg`** anyway, extending the house default (full symmetric
  adoption, decided in Phase 1) rather than carving out an exception for
  status-shaped figures. Budget's "remaining" is signed (over/under budget) and gets
  the conditional `remaining >= 0 ? viz-pos : viz-neg` treatment. Debt has no natural
  sign — a balance or projected interest is always a cost — so it follows the
  "Expenses always red" precedent from `CashFlowSummary`: unconditional
  `var(--viz-neg)`, not a sign check.
- This decision does **not** extend to background/container tone props that happen
  to share the same danger/success vocabulary: `Panel tone=`, `ProgressBar tone=`,
  and the `bg-danger`/`bg-success` tint on Budget's "Left to Budget" hero bar are
  chrome, not a money figure's text color, and stay untouched. Budget's two
  `Badge`-wrapped remaining figures keep the `Badge` pill (a shared status-pill
  component, not specific to money) but get `var(--viz-neg)`/`var(--viz-pos)` passed
  through as an inline `style` override on top of it, plus `data-money` — closing
  the privacy-blur gap without redesigning the pill itself.
- **Review's top summary tiles** (Income/Spending/Net) use `text-success`/
  `text-danger` for genuine inflow/outflow — the same drift pattern already fixed on
  the Dashboard and Cash Flow, just never brought into this rollout's scope because
  Review's original phase description only named its three list blocks. The user
  chose to **fold this into Phase 7** rather than leave it for a future cleanup pass,
  since it's the identical low-risk fix already applied everywhere else.

Everything else in these three phases follows already-settled rules without needing
a fresh decision: dates/labels newly getting `font-mono` (Debt's table header and
stat-grid labels, Budget's `YearTable`/`DecadeTable` month/year row headers,
Wrapped's year chips and highlight-card date/month labels, Receipts' purchase and
candidate dates, Notifications' delivery dates, Sinking Funds' due date) is a
straightforward rule-1 application with no ambiguity. Bare `formatCurrency()` calls
missing `data-money`/`.metric-value` (found across Budget, Debt, Receipts, and two
Settings sections) are privacy-blur bugs, not a design decision — closed regardless
of the color question. `RegisterRow` was not adopted anywhere in these three
phases — deep research confirmed none of these pages has a genuinely flat,
chronologically-ordered `<li>` list at their core (Budget and Debt are category/
account tables; Receipts is a status-sorted card grid; Review's three blocks are
status lists; Notifications' delivery history and Wrapped's highlight cards are too
small/shaped differently to warrant it) — consistent with every prior phase's
restraint principle.

## Page-by-page verdict

| Page | Verdict | Why |
|---|---|---|
| Dashboard | Done | Already fully spec'd and planned (`2026-08-24-dashboard-ledger-strip*.md`); its `RecentActivity` piece is superseded by Phase 0 below. |
| Transactions | **Full** | 808 lines, the largest ledger UI outside the dashboard: day-grouped `LedgerTableRow`, signed amounts, a "positive = money out" caption already present. Highest-leverage page for this rollout. |
| Reports | **Full** | `ReportTransactions` is a bespoke transaction list; `BreakdownBars` already uses `--viz-pos`/`--viz-neg`, just not at row level. |
| Investments | **Full** | `HoldingsTable` is a row list; day-change is already colored `text-success`/`text-danger` (rule 2 fix applies). |
| Recurring | **Full** | `RecurringList` is a chronological (monthly-occurrence) list — same shape as Recent Transactions. |
| Cash Flow | **Partial** | `BreakdownBars` already on the money-direction tokens; no row-level list at the page-shell level to register-ify further. |
| Accounts | **Partial (convention fix)** | Resolve the mono inversion (see above); `NetWorthHero`'s balance-history table is a secondary zebra candidate. Not a chronological transaction list at heart, so no `RegisterRow` adoption. |
| Review | **Partial (confirmed via deep read)** | Three `.map()`-rendered list blocks (budget issues, goal pace, anomalies) confirmed genuinely non-chronological (status/priority-sorted) — `data-money` gaps closed, `remaining`/`projectedSpend` get the Phase 8 color treatment, no zebra (there's no chronology for it to convey). Top summary tiles folded in per the decision above. No `RegisterRow`. |
| Wrapped | **Partial (confirmed via deep read)** | `StatTile`/`BarList` already compliant. Real gaps: year chips and highlight-card date/month labels never got `font-mono`; highlight-card money spans have `.metric-value` but not `data-money`. `StatTile`'s period-over-period delta stays `text-success`/`text-danger` — it's a trend indicator, not a money direction, so rule 2 doesn't apply. No `RegisterRow` (no literal row list on this page). |
| Budget | **Partial (TBD resolved)** | Confirmed grid/envelope-shaped, no chronological list — original "unlikely full register fit" guess holds, no `RegisterRow`. Real work: `data-money` gaps across `BudgetTable`/`BudgetPlanner`/`BudgetRightRail`/`YearTable`/`DecadeTable`, `remaining` figures recolored per the decision above, mono added to period-row headers and stat labels. |
| Debt | **Partial (TBD resolved)** | No payoff schedule exists — `payoffMonth` is a month-count, not a date, and the payoff-order table is priority-sorted, not chronological — original "natural register candidate" guess does not hold, no `RegisterRow`. Real work: balance/interest figures get `data-money` + unconditional `var(--viz-neg)` (cost framing, matching `CashFlowSummary`'s "Expenses always red"), table header and stat labels get `font-mono`. |
| Transactions/Receipts | **Partial (TBD resolved)** | Page shell has no list (confirmed); `ReceiptInbox` itself does — a status-sorted 2-column card grid, not a flat chronological list, so no `RegisterRow` (too dense per row: upload fields, image link, action buttons). Real work: purchase/candidate dates get `font-mono`, totals get `data-money` — closes a real privacy-blur gap on every visible receipt total. |
| Forecasting | **Minimal** | Already uses `.metric-value`/`.money` correctly; it's a projection, not a row list — nothing to register-ify. |
| Goals | **Minimal** | Card grid, not a chronological list. Money figures already exist; no direction-color or register need. |
| Notifications | **Minimal (confirmed via deep read)** | The delivery-history block is inline in `app/notifications/page.tsx`, genuinely date-ordered, no money content — light `font-mono` on dates + zebra. `NotificationFeed`'s separate "recent notifications" list is explicitly out of scope (not the list this phase names). |
| Settings | **Minimal (confirmed via deep read)** | Of the four money-bearing sections named in the roadmap: `BudgetsSection` and `SinkingFundsSection` have real `data-money` gaps (closed) plus one raw due-date (`font-mono` added); `SettleUpSection` already uses `.metric-value` correctly, nothing to do; `CardAprSection` has no currency figures at all (APR is a rate, not money) — the original survey overstated this one. |
| Root (`/`) | **Skip** | Pure session redirect, no content. |
| Login | **Skip** | Auth form, no financial content. |
| Signup | **Skip** | Auth form, no financial content. |
| Advice | **Skip** | Educational checklist, no financial content. |
| Admin | **Skip (optional)** | Internal operational telemetry (sync jobs, audit events), not user-facing finance data. Timestamp lists could take mono treatment purely for internal consistency, but it's optional and low-value. |

"Skip" is a verdict, not an oversight — every one of the 20 routes was read and considered; five have no ledger-like content to extend the motif to, and forcing it on would be exactly the kind of decoration the dashboard spec's restraint principle warns against.

## Sequencing

See `docs/superpowers/plans/2026-08-24-app-wide-register-rollout-roadmap.md`
for the phased rollout plan.
Per the "Scope Check" in this codebase's planning process, a single plan
covering all of the above would not produce independently shippable,
testable software — the roadmap sequences this into Phase 0 (the shared
primitive) plus one phase per page/page-group, each written in full
task-by-task TDD detail (matching the dashboard plan's depth) immediately
before that phase begins, informed by that page's actual current code
rather than guessed from this survey.
