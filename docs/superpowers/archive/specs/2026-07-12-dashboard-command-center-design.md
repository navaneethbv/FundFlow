# FundFlow Dashboard Command Center Design

**Date:** 2026-07-12
**Status:** Approved design, pending written-spec review
**Scope:** Dashboard, dashboard components, shared application shell, and shared visual tokens

## Purpose

FundFlow's dashboard currently presents useful finance data without a strong
priority order. Daily signals such as recent activity, top merchants, anomalies,
budget risk, and cash risk appear below lower-priority planning modules. Empty
cards can interrupt the reading flow, and account cards plus duplicated controls
consume much of the first viewport before the primary monitoring information.

The redesign will make FundFlow feel like a professional personal-finance
monitor. The dashboard will open to a daily Monitor view, while Plan and Wealth
remain separate, focused views. The redesign will reuse existing finance data
and calculations. It will not change transaction semantics, database queries,
authentication, Plaid behavior, or settings workflows.

## Product Priorities

The dashboard has three jobs in this order:

1. **Monitor:** Show what changed, what needs attention, current cash position,
   and recent financial activity.
2. **Plan:** Show budgets, savings goals, forecasts, recurring commitments, debt
   payoff guidance, and sinking-fund guidance.
3. **Wealth:** Show net worth, account balances, assets and liabilities,
   institution and card breakdowns, and longer-term trends.

These jobs must remain separate. Monitor is the default view and must not become
a combined feed of every planning and wealth module.

## Information Architecture

### Shared dashboard header

The dashboard header contains:

- Page title and selected month.
- A compact toolbar for month selection, account filtering, bank connection,
  refresh, sync freshness, and the monthly review link.
- A three-item view switcher: Monitor, Plan, and Wealth.
- Bank error and stale-sync banners only when action is required.

The existing account-card carousel is removed from the shared header and moved
to Wealth. The existing Cards & Banks and Cash Flow Insights top-level tabs are
replaced by the three product views. Their useful content is retained in the new
structure.

### Monitor view

Monitor is ordered for fast daily scanning:

1. **Priority rail:** A concise summary of connected-bank health, sync
   freshness, forecast risk, budget risk, and spending anomalies. Healthy states
   stay compact. Problems become links or clear calls to action using existing
   routes.
2. **Core metrics:** Net worth, monthly cash flow, monthly spending, and savings
   rate. Values use tabular numerals and restrained change indicators.
3. **Primary analysis row:** Spending-versus-income trend as the dominant panel,
   with an attention panel beside it. The attention panel draws from current
   anomalies, at-risk budgets, low-balance risk, and recurring-status issues.
4. **Activity row:** Recent activity first, top merchants second. These panels
   move above planning content and remain visible near the first desktop
   viewport.
5. **Spending detail row:** Spending by category and recurring streams.

Monitor does not render debt payoff, sinking funds, savings-goal management,
account cards, spend-by-bank, or long-term net-worth history.

### Plan view

Plan contains only forward-looking and decision-support modules:

1. Budget envelopes and month-end pace.
2. Savings goals with progress, remaining amount, and required monthly pace.
3. Thirty-day cash forecast.
4. Recurring calendar and recurring payment status.
5. Debt-payoff order and sinking-fund suggestions.

When a data-dependent module has no content, the view does not interleave a
large empty panel between populated panels. Empty modules are grouped into one
compact setup panel that explains which action unlocks the missing insight, such
as creating a budget or goal. A healthy alert category is summarized in the
priority rail or omitted instead of consuming a full card.

### Wealth view

Wealth contains balance-sheet and account-level information:

1. Net-worth total and history as the dominant panel.
2. Assets and liabilities summary.
3. Account-card carousel and account filter controls.
4. Spending by card and spending by bank.
5. Deposits, withdrawals, net cash flow, and depository account balances.

The account-card artwork remains available, but it no longer blocks daily
monitoring content. Selecting an account continues to filter the active month
and preserves the selected dashboard view.

## Layout

Desktop uses a twelve-column content grid with a wider workspace than the
current dashboard. Panels align to consistent row and column boundaries.

```text
Dashboard header and compact toolbar
[ Monitor ] [ Plan ] [ Wealth ]

Monitor
| priority rail                                            |
| metric | metric | metric | metric                       |
| spending vs income, 8 columns | attention, 4 columns    |
| recent activity, 8 columns     | top merchants, 4 cols  |
| spending category, 7 columns   | recurring, 5 columns   |
```

Plan and Wealth use their own ordered grids rather than reusing Monitor's card
positions. Tablet reduces the grid to two columns. Mobile uses one column and
preserves the same priority order. Only the account cards and month controls may
scroll horizontally; the page itself must not scroll horizontally.

## Visual System

The visual direction is a quiet financial operations desk. It should feel
precise and trustworthy rather than playful, luxurious, or trading-oriented.

### Core light tokens

- **Canvas:** `#F5F7FA`
- **Surface:** `#FFFFFF`
- **Ink:** `#101828`
- **Muted ink:** `#667085`
- **Cobalt:** `#175CD3`
- **Positive:** `#067647`
- **Warning:** `#B54708`
- **Negative:** `#B42318`

Existing dark-mode support remains. Dark tokens use the same semantic roles and
must preserve chart contrast and status meaning.

### Typography

- Geist Sans remains the interface and heading face.
- Geist Mono is reserved for high-value currency figures, percentages, account
  masks, and compact data labels.
- Headings use sentence case and restrained weight.
- Uppercase eyebrow labels are reduced to utility contexts rather than repeated
  on every card.

### Surfaces and emphasis

- Panels use thin borders and minimal shadow.
- Radius is tightened slightly for a more instrument-like appearance.
- Accent color communicates selection and navigation, not decoration.
- Green, amber, and red communicate financial or operational meaning only.
- Decorative gradients and hover lift are removed from routine data panels.
- The account-card artwork remains the one expressive visual area.

### Signature element

The priority rail is the dashboard's distinctive element. It reads as one
continuous operational strip rather than a row of unrelated badges. It uses
existing data to answer, at a glance, whether banks are healthy, data is fresh,
cash is at risk, budgets need attention, or unusual activity needs review.

## Components and Boundaries

The implementation should preserve the existing server-rendered dashboard and
small component boundaries.

- `app/dashboard/page.tsx` remains the data-loading and view-routing
  orchestrator.
- A compact dashboard toolbar owns month, account, refresh, connection, and
  review controls.
- A priority-rail component translates existing dashboard and bank states into
  concise operational signals.
- Monitor, Plan, and Wealth are separate view components.
- Existing charts, account cards, goals, planning calculations, and formatting
  helpers are reused where they fit the approved hierarchy.
- Shared `Panel` and `StatTile` primitives may receive narrowly scoped visual
  adjustments needed by the dashboard and shell.
- `AppShell`, `AppSidebar`, and `TopBar` may change layout and styling, but their
  routes and authentication behavior remain unchanged.

No customizable dashboard persistence, drag-and-drop system, new database
tables, new Plaid calls, or generalized layout framework will be introduced.

## Routing and State

The dashboard query string uses `view=monitor`, `view=plan`, or `view=wealth`.
Monitor is the default when `view` is absent or invalid. Existing month and
account query parameters remain supported. Links and filter changes preserve the
active view, selected month, and selected account when applicable.

Legacy `tab=breakdowns` and `tab=cashflow` links should redirect or map to Wealth
so existing sidebar and bookmarked URLs do not become dead ends during the
transition.

## Empty, Healthy, and Error States

- No connected banks keeps the existing primary bank-connection empty state.
- A missing optional dataset does not create an isolated full-size dashboard
  card between populated modules.
- Plan groups missing budgets and goals into one setup panel with direct links.
- Monitor shows a compact healthy message when there are no attention items.
- Bank errors and stale data remain prominent and link to recovery actions.
- Charts with insufficient history show a concise explanation without inventing
  trends.

## Accessibility and Responsive Requirements

- Maintain visible keyboard focus and current link semantics.
- Preserve server-rendered, CSP-safe charts.
- Status must not rely on color alone.
- Interactive targets should be at least 44 pixels where practical on mobile.
- Respect reduced-motion preferences.
- Provide numeric labels for chart data where color contrast alone is
  insufficient.
- Validate light and dark themes at 375, 430, 768, and desktop widths.

## Testing and Verification

Implementation follows a test-first sequence:

1. Add focused tests for the three-view routing, default Monitor behavior,
   legacy tab mapping, active-filter preservation, and view component wiring.
2. Add component or source-level coverage for the priority rail and grouped
   empty-state behavior.
3. Implement the dashboard hierarchy and shell changes.
4. Run focused tests after each slice.
5. Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.
6. Run responsive browser checks for the dashboard in light and dark themes when
   the authenticated local environment is available. Record any credential-
   blocked checks separately from automated verification.

## Out of Scope

- Redesigning Transactions, Goals, Settings, Review, authentication, email, or
  PDF output.
- Changing finance calculations, transaction categorization, Supabase schema,
  Plaid synchronization, or caching semantics.
- User-configurable dashboard layouts.
- New notification or alert types.
- Replacing the existing SVG chart system with a chart library.

## Acceptance Criteria

- Monitor is the default dashboard view.
- Plan and Wealth are separate views and do not merge their full content into
  Monitor.
- Recent activity and top merchants appear before planning-depth content.
- Account cards no longer appear above every dashboard view.
- Empty optional modules do not interrupt populated dashboard content.
- Existing dashboard data, calculations, filters, and recovery actions continue
  to work.
- Legacy Cards & Banks and Cash Flow Insights links remain usable through Wealth.
- The shared shell is visually quieter and avoids duplicated primary actions.
- The dashboard is usable without horizontal page scrolling at the required
  mobile widths.
- Automated tests, lint, build, and diff checks pass.
