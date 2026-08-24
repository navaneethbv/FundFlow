# Accounts Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the one real convention inversion this rollout found: `AccountRow.tsx`, `SummaryPanel.tsx`, `NetWorthHero.tsx`, and `AccountGroup.tsx` currently render **money in `font-mono`** — the opposite of the house rule (mono for labels/dates, proportional sans for money) every other page in this rollout follows. This plan remaps all four money figures to proportional sans, remaps the one place dates/labels sit un-mono'd in the same table (`NetWorthHero`'s balance-history table) to mono, and fixes one adjacent, unrelated gap found along the way (`AccountRow`'s month-change figure has no `data-money` or color at all today).

**User sign-off:** this plan was written only after presenting the exact before/after to the user and confirming they wanted the **full remap** (not a partial one) — see `docs/superpowers/specs/2026-08-24-app-wide-register-design.md`'s Accounts addendum (added alongside this plan) for the record of that decision.

**Architecture:** Unlike every other phase, this one touches **zero row-list structure** — no zebra striping, no `RegisterRow` adoption, no table restructuring. It is purely a font/color-class swap across four components' already-correct `data-money` attributes (none of the four money figures needing a font swap are missing `data-money` — that part was already right). Because this is font-only and research confirmed **no existing test locks in the old mono-on-money behavior** (unlike the debit-color case, there is no `mobile-ledger-list.test.ts`-style test to rewrite here), the primary verification for three of the four components is the existing `accounts-page-render.test.ts` suite staying green plus manual visual QA — not new markup-substring assertions, which would confirm a class name changed but not confirm the page actually *looks* right. The fourth component, `AccountRow`, gets one small new test because its fix adds genuinely new behavior (a privacy-blur hook and color where none existed), not just a font swap.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — Accounts is Phase 6 there; this plan is the just-in-time detail the roadmap said that phase would need.

## Global Constraints

- Money moves from `font-mono` to proportional sans (via `.metric-value` where the figure is a headline, or by simply dropping `font-mono` where it's a smaller supporting figure already using `tabular-nums`). Never introduce a NEW money figure in mono.
- The one table in this scope (`NetWorthHero`'s "View daily balance table") gets its date and currency columns moved INTO `font-mono` — this is the one place text moves in the opposite direction, and it's deliberate (dates/labels belong in mono; they were never given it before).
- `AccountGroup`'s and `NetWorthHero`'s existing month-change coloring (`text-success`/`text-danger`) is **left as-is in this plan** — it already conforms to the money-direction-color house rule in spirit (green/red by sign) and changing it to `var(--viz-pos)`/`var(--viz-neg)` was not part of what was researched or signed off on; only the font-family inversion and the one `AccountRow` gap are in scope here. Do not expand scope to recolor these without checking first.
- Every money figure must carry `.money`, `.metric-value`, or `data-money` — this plan closes the one place that's missing (`AccountRow`'s month-change figure), and does not remove `data-money` from any of the four figures whose font changes.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or `scripts/validate_palette.js`.
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite; `npx tsc --noEmit`; `npm run build`; `npm run lint`.

---

### Task 1: `AccountRow.tsx` — balance font fix, month-change privacy-blur/color fix

**Files:**
- Modify: `components/accounts/AccountRow.tsx`
- Test: `tests/unit/account-row-register.test.ts` (new)

**Interfaces:** None new — `AccountRow`'s props (`row: AccountsPageRow`) are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/account-row-register.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountRow from "@/components/accounts/AccountRow";
import type { AccountsPageRow } from "@/lib/accounts-page";

function row(partial: Partial<AccountsPageRow> = {}): AccountsPageRow {
  return {
    id: "acct-1",
    ownerUserId: "user-1",
    source: "plaid",
    name: "Checking",
    type: "depository",
    subtype: "checking",
    balance: 4820.55,
    currency: "USD",
    institution: "Demo Bank",
    institutionLogo: null,
    institutionBrandColor: null,
    updatedAgo: "2 hours ago",
    stale: false,
    spark: [100, 110, 120],
    sparkLong: [100, 110, 120, 130],
    monthChange: null,
    includeInNetWorth: true,
    ...partial,
  };
}

describe("AccountRow", () => {
  it("renders the balance in the proportional money face, not mono", () => {
    const html = renderToStaticMarkup(createElement(AccountRow, { row: row() }));
    expect(html).toContain("metric-value");
    expect(html).not.toContain("font-mono");
  });

  it("marks a positive month-change with the privacy-blur hook and the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(AccountRow, { row: row({ monthChange: { amount: 100, pct: 11.11 } }) }),
    );
    expect(html).toContain("data-money");
    expect(html).toContain("var(--viz-pos)");
  });

  it("colors a negative month-change with the negative diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(AccountRow, { row: row({ monthChange: { amount: -100, pct: -11.11 } }) }),
    );
    expect(html).toContain("var(--viz-neg)");
  });

  it("shows the fallback message, uncolored, when there is no month change on record", () => {
    const html = renderToStaticMarkup(createElement(AccountRow, { row: row({ monthChange: null }) }));
    expect(html).toContain("Not enough history");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/account-row-register.test.ts`
Expected: FAIL — the mono test fails (current code has `font-mono` and no `metric-value` on the balance); the two month-change color tests fail (current code has no `data-money` and no color on that line at all — it's plain `text-muted`). The fallback-message test should already pass.

- [ ] **Step 3: Write the implementation**

In `components/accounts/AccountRow.tsx`, change the closing block of the component (the `<div className="text-left sm:text-right">` section) from:

```tsx
      <div className="text-left sm:text-right">
        <p data-money className="font-mono text-sm font-bold tabular-nums">
          {row.balance === null
            ? "Unavailable"
            : formatCurrency(row.balance, row.currency)}
        </p>
        <p
          className={
            row.stale
              ? "mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
              : "mt-1 text-xs text-muted"
          }
        >
          {row.stale ? `Stale, updated ${row.updatedAgo}` : row.updatedAgo}
        </p>
        <p className="mt-1 text-xs text-muted tabular-nums">
          {change ?? "Not enough history"}
        </p>
      </div>
```

to:

```tsx
      <div className="text-left sm:text-right">
        <p data-money className="metric-value text-sm">
          {row.balance === null
            ? "Unavailable"
            : formatCurrency(row.balance, row.currency)}
        </p>
        <p
          className={
            row.stale
              ? "mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
              : "mt-1 text-xs text-muted"
          }
        >
          {row.stale ? `Stale, updated ${row.updatedAgo}` : row.updatedAgo}
        </p>
        <p className="mt-1 text-xs tabular-nums">
          {change ? (
            <span
              data-money
              style={{ color: row.monthChange!.amount >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
            >
              {change}
            </span>
          ) : (
            "Not enough history"
          )}
        </p>
      </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/account-row-register.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Confirm the existing accounts render suite still passes**

Run: `npx vitest run tests/unit/accounts-page-render.test.ts`
Expected: PASS unchanged — that file doesn't assert on `font-mono`/`data-money`/`metric-value` strings (confirmed by research), so a pure class-name change here shouldn't affect it, but confirm nothing else broke.

- [ ] **Step 6: Commit**

```bash
git add components/accounts/AccountRow.tsx tests/unit/account-row-register.test.ts
git commit -m "fix: render account balances in the proportional money face and cover month-change with the privacy-blur hook"
```

---

### Task 2: `SummaryPanel.tsx` — net worth headline font fix

**Files:**
- Modify: `components/accounts/SummaryPanel.tsx`

**Interfaces:** None new.

No dedicated test — this is a pure font-class swap on a figure that already carries `data-money` and is already covered by `accounts-page-render.test.ts`'s general rendering assertions (which don't check font class, per research). Verification is that existing suite staying green, plus Task 5's manual QA, which is the only way to actually confirm this looks right — a markup assertion would only prove a class string changed, not that the page reads correctly.

- [ ] **Step 1: Write the implementation**

In `components/accounts/SummaryPanel.tsx`, change:

```tsx
              <p data-money className="mt-2 font-mono text-2xl font-bold tabular-nums">
                {mode === "percent"
                  ? percentLabel
                  : formatCurrency(netWorth, currency)}
              </p>
```

to:

```tsx
              <p data-money className="metric-value mt-2 text-2xl">
                {mode === "percent"
                  ? percentLabel
                  : formatCurrency(netWorth, currency)}
              </p>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Confirm the existing accounts render suite still passes**

Run: `npx vitest run tests/unit/accounts-page-render.test.ts`
Expected: PASS unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/accounts/SummaryPanel.tsx
git commit -m "fix: render the per-currency net worth headline in the proportional money face"
```

---

### Task 3: `NetWorthHero.tsx` — balance-history table: money to sans, dates/currency to mono

**Files:**
- Modify: `components/accounts/NetWorthHero.tsx`

**Interfaces:** None new.

No dedicated test — same reasoning as Task 2 (pure class swap, no existing test locks in the old behavior, real verification is visual). This is the one component in this plan where text moves in *both* directions in the same table, so manual QA (Task 5) should look at this table specifically, not just the headline figure above it.

- [ ] **Step 1: Write the implementation**

In `components/accounts/NetWorthHero.tsx`, change the table header row:

```tsx
              <tr className="border-b border-panel-border text-muted">
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Currency</th>
                <th className="px-2 py-2 text-right font-semibold">Net worth</th>
              </tr>
```

to:

```tsx
              <tr className="border-b border-panel-border text-muted font-mono">
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Currency</th>
                <th className="px-2 py-2 text-right font-semibold">Net worth</th>
              </tr>
```

Change:

```tsx
                  <tr key={`${currency}-${point.date}`} className="border-b border-panel-border/70">
                    <td className="px-2 py-2">{point.date}</td>
                    <td className="px-2 py-2">{currency}</td>
                    <td data-money className="px-2 py-2 text-right font-mono tabular-nums">
                      {formatCurrency(point.value, currency)}
                    </td>
                  </tr>
```

to:

```tsx
                  <tr key={`${currency}-${point.date}`} className="border-b border-panel-border/70">
                    <td className="px-2 py-2 font-mono">{point.date}</td>
                    <td className="px-2 py-2 font-mono">{currency}</td>
                    <td data-money className="px-2 py-2 text-right tabular-nums">
                      {formatCurrency(point.value, currency)}
                    </td>
                  </tr>
```

(The page-top headline figure at `data-money className="metric-value text-4xl"` and the month-change line just below it are already correct — confirmed by research — and are not touched by this task.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Confirm the existing accounts render suite still passes**

Run: `npx vitest run tests/unit/accounts-page-render.test.ts`
Expected: PASS unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/accounts/NetWorthHero.tsx
git commit -m "fix: swap font treatment in the daily balance table (money to sans, date/currency to mono)"
```

---

### Task 4: `AccountGroup.tsx` — group total pill font fix

**Files:**
- Modify: `components/accounts/AccountGroup.tsx`

**Interfaces:** None new.

No dedicated test — same reasoning as Tasks 2 and 3.

- [ ] **Step 1: Write the implementation**

In `components/accounts/AccountGroup.tsx`, change:

```tsx
                <span
                  data-money
                  className="block rounded-full bg-panel-2 px-2.5 py-1 font-mono text-xs font-bold tabular-nums"
                >
                  {formatCurrency(total.amount, total.currency)}
                </span>
```

to:

```tsx
                <span
                  data-money
                  className="block rounded-full bg-panel-2 px-2.5 py-1 text-xs font-bold tabular-nums"
                >
                  {formatCurrency(total.amount, total.currency)}
                </span>
```

(The group month-change line just below this pill already uses `text-success`/`text-danger` correctly and is not touched by this task, per the Global Constraints note above.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Confirm the existing accounts render suite still passes**

Run: `npx vitest run tests/unit/accounts-page-render.test.ts`
Expected: PASS unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/accounts/AccountGroup.tsx
git commit -m "fix: render the group total pill in the proportional money face"
```

---

### Task 5: Full verification and manual QA (visual comparison required)

**Files:** None (verification only).

This task carries more weight than usual: this plan was explicitly flagged to the user as a visual-regression risk on an already-shipped page, and three of its four fixes have no automated markup test. The manual check below is the actual verification for most of this plan's work, not a formality.

- [ ] **Step 1: Full automated verification**

Run in order:

```bash
npm run lint
npx tsc --noEmit
npm run test:unit
npm run build
```

All four must pass clean.

- [ ] **Step 2: Manual browser check, with before/after screenshots**

If possible, take a screenshot of `/accounts` on `main` (or the branch's base commit) before starting, so there's a real before/after to compare rather than relying on memory.

```bash
npm run dev
```

Open `/accounts` signed in as a user with at least two accounts in at least two different asset-class groups, and at least one account with enough balance history to populate the "View daily balance table." Confirm, comparing directly against the before screenshot where possible:

- Every account row's balance (in the account list) now renders in the app's normal proportional numeral style, not monospaced — check that it's still legible, still right-aligned, still bold enough to read as the row's headline figure.
- The "Balance sheet" panel's big per-currency net worth figure is now proportional sans, not mono.
- Each asset-class group header's total pill (e.g. "Cash — $3,400.00") is now proportional sans, not mono.
- The page-top net worth hero figure and its month-change line are unchanged (they were already correct).
- Open the "View daily balance table" disclosure: the Net worth column is now proportional sans; the Date and Currency columns are now in the mono face.
- A row with a real month-over-month change now shows that change in green (gain) or red (loss) and blurs under the privacy toggle — confirm this is new (it showed no color and didn't blur before this plan).
- Toggle dark mode: everything above still reads correctly.
- Confirm nothing about layout, spacing, or information content changed — every change in this plan is font-family/color only.

If anything looks visually wrong or worse than before — not just "different" but actually worse (misaligned, illegible, too subtle to read) — stop and report it rather than treating a passing test suite as sufficient sign-off. That was the whole reason this plan required confirmation before being written.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.
