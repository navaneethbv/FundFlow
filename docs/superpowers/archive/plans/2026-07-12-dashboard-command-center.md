# FundFlow Dashboard Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize FundFlow into a professional dashboard command center with Monitor as the default view and separate Plan and Wealth views.

**Architecture:** Keep `app/dashboard/page.tsx` as the server-side data orchestrator. Add one pure routing helper, one compact toolbar, one priority rail, and three focused view components that reuse the existing dashboard data and chart primitives. Update the shared shell and visual tokens without changing finance calculations, Supabase queries, Plaid behavior, or protected-page routing.

**Tech Stack:** Next.js 16 App Router, React 19 server components, TypeScript 6, Tailwind CSS 4, Vitest 4, existing CSP-safe SVG chart components

## Global Constraints

- Monitor is the default dashboard view; Plan and Wealth remain separate views.
- Scope is limited to the dashboard, dashboard components, shared application shell, and shared visual tokens.
- Do not change finance calculations, transaction categorization, Supabase schema, Plaid synchronization, authentication, caching semantics, or unrelated pages.
- Reuse the existing SVG chart system and account-card artwork.
- Preserve `accountId` and `month` query parameters across dashboard navigation.
- Map legacy `tab=breakdowns` and `tab=cashflow` URLs to Wealth.
- Hide empty optional modules or group them into one contextual setup panel.
- Maintain visible keyboard focus, reduced-motion support, status text that does not rely on color alone, and no horizontal page scrolling at 375, 430, 768, and desktop widths.
- Use test-first slices and commit each independently working change.

---

## File Structure

### Create

- `components/dashboard/dashboard-view.ts`: Pure dashboard view resolution and URL construction.
- `components/dashboard/DashboardToolbar.tsx`: Month, account, sync, connection, refresh, and review controls.
- `components/dashboard/PriorityRail.tsx`: Operational signals derived from already-loaded dashboard state.
- `components/dashboard/MonitorView.tsx`: Daily metrics, attention, activity, merchants, categories, and recurring streams.
- `components/dashboard/PlanView.tsx`: Budgets, goals, forecast, recurring planning, debt payoff, sinking funds, and grouped setup prompts.
- `components/dashboard/WealthView.tsx`: Net worth, accounts, card/bank breakdowns, cash flow, and depository balances.
- `tests/unit/dashboard-command-center.test.ts`: Routing, priority signals, setup grouping, view wiring, and shell regression coverage.

### Modify

- `app/dashboard/page.tsx`: Resolve the active view, render the toolbar and view switcher, and pass existing data to the focused views.
- `components/shell/AppSidebar.tsx`: Replace duplicated dashboard destinations with Monitor, Plan, and Wealth navigation groups.
- `components/shell/TopBar.tsx`: Remove duplicate Transactions and Settings links and tighten the top bar.
- `components/shell/AppShell.tsx`: Increase the data workspace and align shell dimensions.
- `components/ui/Panel.tsx`: Reduce routine card elevation and support the command-center surface treatment.
- `components/charts/StatTile.tsx`: Use utility typography for data and remove decorative hover lift.
- `app/globals.css`: Apply the approved light and dark token system.
- `tests/unit/dashboard-ui.test.ts`: Replace old `OverviewTab` orchestration expectations.
- `tests/unit/planning-ui.test.ts`: Assert planning data is wired into Plan rather than Overview.
- `tests/unit/ui-overhaul.test.ts`: Assert the new sidebar destinations and active states.

### Remove after references are migrated

- `components/dashboard/OverviewTab.tsx`
- `components/dashboard/PlanningInsights.tsx`
- `components/dashboard/BreakdownsTab.tsx`
- `components/dashboard/CashflowTab.tsx`

`PlanningDepth.tsx`, `GoalsSummary.tsx`, `CardCarousel.tsx`, charts, `RecentActivity.tsx`, and `BarList.tsx` remain reusable focused components.

---

### Task 1: Dashboard View Contract

**Files:**
- Create: `components/dashboard/dashboard-view.ts`
- Create: `tests/unit/dashboard-command-center.test.ts`

**Interfaces:**
- Produces: `DashboardView = "monitor" | "plan" | "wealth"`
- Produces: `resolveDashboardView(params: { view?: string; tab?: string }): DashboardView`
- Produces: `dashboardHref(params: { view: DashboardView; accountId?: string; month?: string }): string`

- [ ] **Step 1: Write the failing routing tests**

```ts
import { describe, expect, it } from "vitest";
import { dashboardHref, resolveDashboardView } from "@/components/dashboard/dashboard-view";

describe("dashboard command center", () => {
  it("defaults to Monitor and maps legacy analysis tabs to Wealth", () => {
    expect(resolveDashboardView({})).toBe("monitor");
    expect(resolveDashboardView({ view: "plan" })).toBe("plan");
    expect(resolveDashboardView({ view: "wealth" })).toBe("wealth");
    expect(resolveDashboardView({ view: "unknown" })).toBe("monitor");
    expect(resolveDashboardView({ tab: "breakdowns" })).toBe("wealth");
    expect(resolveDashboardView({ tab: "cashflow" })).toBe("wealth");
  });

  it("preserves account and month filters in dashboard links", () => {
    expect(
      dashboardHref({ view: "plan", accountId: "account-1", month: "2026-07" }),
    ).toBe("/dashboard?view=plan&accountId=account-1&month=2026-07");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts`

Expected: FAIL because `components/dashboard/dashboard-view.ts` does not exist.

- [ ] **Step 3: Implement the pure routing helper**

```ts
export type DashboardView = "monitor" | "plan" | "wealth";

export function resolveDashboardView({
  view,
  tab,
}: {
  view?: string;
  tab?: string;
}): DashboardView {
  if (view === "plan" || view === "wealth" || view === "monitor") return view;
  if (tab === "breakdowns" || tab === "cashflow") return "wealth";
  return "monitor";
}

export function dashboardHref({
  view,
  accountId,
  month,
}: {
  view: DashboardView;
  accountId?: string;
  month?: string;
}) {
  const params = new URLSearchParams({ view });
  if (accountId) params.set("accountId", accountId);
  if (month) params.set("month", month);
  return `/dashboard?${params.toString()}`;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts`

Expected: PASS for both routing tests.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/dashboard-view.ts tests/unit/dashboard-command-center.test.ts
git commit -m "test: define dashboard command center routing"
```

---

### Task 2: Priority Rail and Compact Toolbar

**Files:**
- Create: `components/dashboard/PriorityRail.tsx`
- Create: `components/dashboard/DashboardToolbar.tsx`
- Modify: `tests/unit/dashboard-command-center.test.ts`

**Interfaces:**
- Produces: `buildPrioritySignals(input: PriorityInput): PrioritySignal[]`
- Produces: `PriorityRail(props: PriorityInput & { selectedMonth: string }): JSX.Element`
- Produces: `DashboardToolbar(props)` with accounts, month, bank state, sync state, and active view.
- Consumes: `DashboardView`, `dashboardHref`, `AccountSummary`, existing `ConnectBankButton`, `RefreshButton`, and `MonthChips` behavior.

- [ ] **Step 1: Add failing signal tests**

```ts
import { buildPrioritySignals } from "@/components/dashboard/PriorityRail";

it("summarizes healthy and actionable financial states", () => {
  const healthy = buildPrioritySignals({
    brokenBankCount: 0,
    isStale: false,
    lastSyncAgoMinutes: 8,
    lowBalanceRisk: false,
    budgetRiskCount: 0,
    anomalyCount: 0,
  });
  expect(healthy.map((signal) => signal.label)).toEqual([
    "Banks healthy",
    "Synced 8m ago",
    "Cash outlook stable",
    "Budgets on track",
    "No unusual activity",
  ]);

  const attention = buildPrioritySignals({
    brokenBankCount: 1,
    isStale: true,
    lastSyncAgoMinutes: 3010,
    lowBalanceRisk: true,
    budgetRiskCount: 2,
    anomalyCount: 3,
  });
  expect(attention.filter((signal) => signal.tone !== "neutral")).toHaveLength(5);
  expect(attention[0]?.href).toBe("/settings");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts`

Expected: FAIL because `PriorityRail.tsx` does not exist.

- [ ] **Step 3: Implement the signal builder and rail**

Use these exact public types and signal semantics:

```ts
export type PriorityTone = "neutral" | "good" | "warning" | "danger";

export type PriorityInput = {
  brokenBankCount: number;
  isStale: boolean;
  lastSyncAgoMinutes: number | null;
  lowBalanceRisk: boolean;
  budgetRiskCount: number;
  anomalyCount: number;
};

export type PrioritySignal = {
  label: string;
  tone: PriorityTone;
  href?: string;
};
```

`buildPrioritySignals` returns exactly five signals in this order: bank health,
sync freshness, cash outlook, budget risk, and anomaly review. Broken banks link
to `/settings`, risky budgets link to `/settings#budgets`, and anomalies link to
`/review`. The component renders one `aria-label="Financial status"` region with
text labels and small semantic dots.

- [ ] **Step 4: Implement the compact toolbar**

`DashboardToolbar` renders a single bordered surface with:

```tsx
<div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
  <div className="flex flex-wrap items-center gap-2">
    <ConnectBankButton />
    {hasBanks && <RefreshButton />}
    <ButtonLink href={`/review?month=${selectedMonth}`}>Monthly review</ButtonLink>
    <span>{formatMinutesAgo(lastSyncAgoMinutes)}</span>
  </div>
  <nav aria-label="Account filter" className="flex gap-2 overflow-x-auto">
    <Link href={dashboardHref({ view: activeView, month: selectedMonth })}>All accounts</Link>
    {accounts.map((account) => (
      <Link
        key={account.id}
        href={dashboardHref({ view: activeView, accountId: account.id, month: selectedMonth })}
      >
        {account.name ?? "Account"}{account.mask ? ` ${account.mask}` : ""}
      </Link>
    ))}
  </nav>
</div>
<MonthChips
  months={months}
  selectedMonth={selectedMonth}
  selectedAccountId={selectedAccountId}
  activeView={activeView}
/>
```

Update `MonthChips` to accept `activeView: DashboardView` and build links with
`dashboardHref`. Account links use `dashboardHref` and show `name` plus the final
four mask digits. Do not add a client router or form state.

- [ ] **Step 5: Run focused tests and lint the new files**

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts && npx eslint components/dashboard/PriorityRail.tsx components/dashboard/DashboardToolbar.tsx components/dashboard/MonthChips.tsx`

Expected: PASS with no lint errors.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/PriorityRail.tsx components/dashboard/DashboardToolbar.tsx components/dashboard/MonthChips.tsx tests/unit/dashboard-command-center.test.ts
git commit -m "feat: add dashboard status rail and toolbar"
```

---

### Task 3: Monitor View

**Files:**
- Create: `components/dashboard/MonitorView.tsx`
- Modify: `tests/unit/dashboard-command-center.test.ts`
- Modify: `tests/unit/dashboard-ui.test.ts`
- Remove after page migration: `components/dashboard/OverviewTab.tsx`

**Interfaces:**
- Produces: `MonitorView({ data, netWorth, savingsRate, recentTransactions, accountNames }): JSX.Element`
- Consumes: `DashboardData`, `Goal[]`, `RecentTransaction[]`, current chart and formatting helpers.

- [ ] **Step 1: Add failing hierarchy tests**

```ts
import { existsSync, readFileSync } from "node:fs";

it("keeps daily monitoring content ahead of secondary detail", () => {
  expect(existsSync("components/dashboard/MonitorView.tsx")).toBe(true);
  const source = readFileSync("components/dashboard/MonitorView.tsx", "utf8");
  expect(source.indexOf("Recent activity")).toBeLessThan(source.indexOf("Spending by category"));
  expect(source.indexOf("Top merchants")).toBeLessThan(source.indexOf("Recurring streams"));
  expect(source).not.toContain("PlanningDepth");
  expect(source).not.toContain("CardCarousel");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts`

Expected: FAIL because `MonitorView.tsx` does not exist.

- [ ] **Step 3: Build Monitor with the approved order**

Move the existing metric and chart preparation from `OverviewTab` into
`MonitorView`. Render in this order:

```tsx
<div className="space-y-5">
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {metricCards.map((metric) => <StatTile key={metric.label} {...metric} />)}
  </div>
  <div className="grid gap-5 xl:grid-cols-12">
    <Panel title="Spending versus income" className="xl:col-span-8">
      <TrendChart labels={monthLabels} series={trendSeries} />
    </Panel>
    <Panel title="Needs attention" className="xl:col-span-4">
      {attentionItems.length > 0
        ? attentionItems.slice(0, 3).map((item) => <p key={item}>{item}</p>)
        : <p>Nothing needs attention right now.</p>}
    </Panel>
  </div>
  <div className="grid gap-5 xl:grid-cols-12">
    <Panel title="Recent activity" className="xl:col-span-8">
      <RecentActivity transactions={recentTransactions} accountNames={accountNames} />
    </Panel>
    <Panel title="Top merchants" className="xl:col-span-4">
      <BarList items={merchantItems} max={maxMerchant} />
    </Panel>
  </div>
  <div className="grid gap-5 xl:grid-cols-12">
    <Panel title="Spending by category" className="xl:col-span-7">
      <DonutChart items={donutItems} centerLabel="spent" />
    </Panel>
    {data.subscriptions.length > 0 && (
      <Panel title="Recurring streams" className="xl:col-span-5">
        {data.subscriptions.slice(0, 5).map((stream) => (
          <p key={`${stream.merchant}-${stream.amount}`}>{stream.merchant}</p>
        ))}
      </Panel>
    )}
  </div>
</div>
```

The attention panel shows up to three items with explicit text. When all
attention sources are healthy, render `Nothing needs attention right now.` in a
compact healthy state. Do not render empty full-size panels.

- [ ] **Step 4: Update dashboard component tests**

Replace old `OverviewTab` and `PlanningInsights` assertions with `MonitorView`,
`PlanView`, and `WealthView` file expectations. Keep the pure net-worth and
savings-rate tests unchanged.

- [ ] **Step 5: Run focused tests**

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts tests/unit/dashboard-ui.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/MonitorView.tsx tests/unit/dashboard-command-center.test.ts tests/unit/dashboard-ui.test.ts
git commit -m "feat: prioritize daily dashboard monitoring"
```

---

### Task 4: Separate Plan and Wealth Views

**Files:**
- Create: `components/dashboard/PlanView.tsx`
- Create: `components/dashboard/WealthView.tsx`
- Modify: `components/dashboard/CardCarousel.tsx`
- Modify: `components/dashboard/PlanningDepth.tsx`
- Modify: `tests/unit/dashboard-command-center.test.ts`
- Modify: `tests/unit/planning-ui.test.ts`
- Remove after migration: `components/dashboard/PlanningInsights.tsx`
- Remove after migration: `components/dashboard/BreakdownsTab.tsx`
- Remove after migration: `components/dashboard/CashflowTab.tsx`

**Interfaces:**
- Produces: `getPlanSetupItems(data: Pick<DashboardData, "budgetEnvelopes" | "recurringWeeks" | "recurringStatuses">, goals: Goal[]): PlanSetupItem[]`
- Produces: `PlanView({ data, goals }): JSX.Element`
- Produces: `WealthView({ data, selectedAccountId, selectedMonth }): JSX.Element`
- Consumes: existing `PlanningDepth`, `GoalsSummary`, `CardCarousel`, `TrendChart`, `DivergingColumns`, `BarList`, and formatting helpers.

- [ ] **Step 1: Add failing Plan grouping tests**

```ts
import { getPlanSetupItems } from "@/components/dashboard/PlanView";

it("groups missing planning data into one setup list", () => {
  const items = getPlanSetupItems(
    { budgetEnvelopes: [], recurringWeeks: [], recurringStatuses: [] },
    [],
  );
  expect(items).toEqual([
    { label: "Create a monthly budget", href: "/settings#budgets" },
    { label: "Add a savings goal", href: "/goals" },
    { label: "Refresh recurring transactions", href: "/settings" },
  ]);
});
```

Define the helper input as a narrow `Pick<DashboardData, "budgetEnvelopes" | "recurringWeeks" | "recurringStatuses">` so the test does not need a full dashboard fixture.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts`

Expected: FAIL because `PlanView.tsx` does not exist.

- [ ] **Step 3: Implement Plan**

Render populated modules only, in this order: budget envelopes, goals, cash
forecast, recurring calendar/status, then `PlanningDepth`. When setup items
exist, render one `Panel title="Set up your plan"` containing all setup links.
Use the existing badge tones, goal summary, budget progress bars, forecast
assumptions, and planning-depth calculations. Remove the net-worth panel from
planning.

- [ ] **Step 4: Implement Wealth**

Render in this order:

```tsx
<div className="space-y-5">
  <div className="grid gap-5 xl:grid-cols-12">
    <Panel title="Net worth" className="xl:col-span-8">
      <TrendChart labels={historyLabels} series={netWorthSeries} />
    </Panel>
    <Panel title="Balance sheet" className="xl:col-span-4">
      <dl>{balanceSheetRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{formatCurrency(row.value)}</dd></div>)}</dl>
    </Panel>
  </div>
  <CardCarousel accounts={data.accounts} selectedAccountId={selectedAccountId} selectedMonth={selectedMonth} activeView="wealth" />
  <div className="grid gap-5 xl:grid-cols-2">
    <Panel title="Spend by card"><BarList items={cardItems} max={maxCard} /></Panel>
    <Panel title="Spend by bank"><BarList items={bankItems} max={maxBank} /></Panel>
  </div>
  <div className="grid gap-5 sm:grid-cols-3">
    {cashFlowMetrics.map((metric) => <Panel key={metric.label} title={metric.label}>{formatCurrency(metric.value)}</Panel>)}
  </div>
  <Panel title="Cash flow history">
    <DivergingColumns labels={cashFlowLabels} up={deposits} down={withdrawals} upName="Deposits" downName="Withdrawals" />
  </Panel>
  {depositoryAccounts.length > 0 && (
    <Panel title="Depository accounts">
      {depositoryAccounts.map((account) => <p key={account.id}>{account.name}</p>)}
    </Panel>
  )}
</div>
```

Update `CardCarousel` to accept `activeView: DashboardView` and use
`dashboardHref`. Preserve account-selection toggle behavior and card artwork.

- [ ] **Step 5: Update planning tests and run focused coverage**

Update `planning-ui.test.ts` to expect budget, forecast, recurring, and
`PlanningDepth` wiring in `PlanView`, and net-worth history in `WealthView`.

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts tests/unit/planning-ui.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/PlanView.tsx components/dashboard/WealthView.tsx components/dashboard/CardCarousel.tsx components/dashboard/PlanningDepth.tsx tests/unit/dashboard-command-center.test.ts tests/unit/planning-ui.test.ts
git commit -m "feat: separate planning and wealth dashboards"
```

---

### Task 5: Page Wiring, Shell, and Visual System

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `components/shell/AppSidebar.tsx`
- Modify: `components/shell/TopBar.tsx`
- Modify: `components/shell/AppShell.tsx`
- Modify: `components/ui/Panel.tsx`
- Modify: `components/charts/StatTile.tsx`
- Modify: `app/globals.css`
- Modify: `tests/unit/dashboard-command-center.test.ts`
- Modify: `tests/unit/ui-overhaul.test.ts`
- Remove: `components/dashboard/OverviewTab.tsx`
- Remove: `components/dashboard/PlanningInsights.tsx`
- Remove: `components/dashboard/BreakdownsTab.tsx`
- Remove: `components/dashboard/CashflowTab.tsx`

**Interfaces:**
- Consumes: all view components and dashboard routing helpers from Tasks 1 to 4.
- Produces: the complete routed command-center dashboard and quieter shared shell.

- [ ] **Step 1: Add failing page and shell wiring tests**

Assert that `app/dashboard/page.tsx` imports and renders `MonitorView`,
`PlanView`, `WealthView`, `DashboardToolbar`, and `PriorityRail`; uses
`resolveDashboardView`; and does not import `OverviewTab`, `BreakdownsTab`, or
`CashflowTab`. Assert that the sidebar contains these exact destinations:

```ts
for (const href of [
  "/dashboard?view=monitor",
  "/dashboard?view=plan",
  "/dashboard?view=wealth",
  "/transactions",
  "/goals",
  "/settings#reports",
  "/settings",
]) {
  expect(sidebar).toContain(`href: "${href}"`);
}
expect(topBar).not.toContain('href="/transactions"');
expect(topBar).not.toContain('href="/settings"');
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts tests/unit/ui-overhaul.test.ts`

Expected: FAIL on old page and sidebar wiring.

- [ ] **Step 3: Wire the dashboard page**

Add `view?: string` to `searchParams`, resolve the view with
`resolveDashboardView(params)`, and keep `AppShell active` aligned with Monitor,
Plan, or Wealth. Render the page title, compact toolbar, view switcher, freshness
banner, priority rail, and exactly one view component. Keep the no-bank empty
state unchanged. The view switcher uses `dashboardHref` and preserves month and
account filters.

- [ ] **Step 4: Simplify the shell**

Set sidebar primary navigation to Monitor, Plan, Wealth, and Transactions. Set a
visually separated Manage group to Goals, Reports, and Settings. Remove duplicate
Transactions and Settings links from `TopBar`. Keep email, theme toggle, and
logout. Reduce the desktop top-bar height to 64 pixels, align the sidebar sticky
offset to 64 pixels, use a 240-pixel sidebar, and increase the content maximum
width to 1320 pixels.

- [ ] **Step 5: Apply the approved tokens and panel treatment**

Set light tokens to:

```css
--background: #f5f7fa;
--foreground: #101828;
--panel: #ffffff;
--panel-2: #f8fafc;
--muted: #667085;
--accent: #175cd3;
--success: #067647;
--warning: #b54708;
--danger: #b42318;
```

Use compatible dark semantic values, preserve existing `--viz-*` variables,
remove body decorative radial gradients, tighten `--radius-card` to `0.75rem`,
and reduce `--shadow-card` to a single subtle shadow. Remove routine hover
translation from `StatTile`. Use Geist Mono for high-value metric numerals via a
new `.metric-value` utility class.

- [ ] **Step 6: Remove migrated legacy view files and run focused tests**

Run: `npm run test:unit -- tests/unit/dashboard-command-center.test.ts tests/unit/dashboard-ui.test.ts tests/unit/planning-ui.test.ts tests/unit/ui-overhaul.test.ts`

Expected: PASS with no imports of removed files.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/page.tsx app/globals.css components/dashboard components/shell components/ui/Panel.tsx components/charts/StatTile.tsx tests/unit/dashboard-command-center.test.ts tests/unit/dashboard-ui.test.ts tests/unit/planning-ui.test.ts tests/unit/ui-overhaul.test.ts
git commit -m "feat: deliver dashboard command center redesign"
```

---

### Task 6: Full Verification and Responsive Review

**Files:**
- Modify only files needed to fix failures directly caused by Tasks 1 to 5.

**Interfaces:**
- Consumes: complete dashboard command center.
- Produces: verified implementation with documented manual limitations.

- [ ] **Step 1: Run all unit tests**

Run: `npm run test:unit`

Expected: all unit tests pass.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: all configured tests pass; credential-gated integration suites may
report their existing skip behavior.

- [ ] **Step 3: Run lint, build, and whitespace checks**

Run: `npm run lint && npm run build && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 4: Inspect the production build with authenticated browser state when available**

Check `/dashboard?view=monitor`, `/dashboard?view=plan`, and
`/dashboard?view=wealth` in light and dark themes at 375, 430, 768, and desktop
widths. Confirm no page-level horizontal scroll, clear focus states, the required
content order, account-card-only horizontal scrolling, and readable charts. If
credentials or bank data are unavailable, record that limitation and inspect the
no-bank state instead of claiming the populated views were visually verified.

- [ ] **Step 5: Review the diff for scope and commit any verification fixes**

Run: `git status --short && git diff --stat && git diff --check`

Expected: only dashboard, shell, visual token, test, spec, and plan files are
changed. If verification required fixes, stage only the exact dashboard or shell
files listed by `git status --short` and commit them with
`git commit -m "fix: polish dashboard command center"`. If no fixes were needed,
do not create an empty commit.
