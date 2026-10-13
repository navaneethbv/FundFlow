# Budget, goal, and debt planning

## Intent

Add 15 further non-AI features on top of the transaction/reporting work in PR #225. Extend Budget, Goals, and Debt with practical exploration and explicit what-if calculations. Scenario edits remain in component memory; they do not update balances, schedules, budgets, goals, or account settings. No new provider calls, schema changes, production mutations, or deployments.

## Acceptance contract

### Budget exploration (1–5)

1. Search monthly budget categories by literal case-insensitive name/category.
2. Filter categories needing attention: overspent, unbudgeted, unused, or all. Income has its own semantics and cannot be mislabeled overspent.
3. Sort categories by planned order, largest spending, least remaining, or name, with deterministic ties. Summary totals always describe the full budget and filtered-row counts are explicit.
4. Show month-end spending pace for the current viewer month: actual spending divided by elapsed calendar days times days in month. Label it a projection assuming unchanged pace, never a forecast guarantee; suppress it on incomplete data, unknown currency, historical/future months, and invalid dates. Refunds net expenses.
5. Preview moving budget between two distinct editable expense categories. Require positive finite cents and sufficient source remaining/planned allocation. Show both categories before/after and unchanged overall planned spending. No save or database action is part of this preview.

### Savings-goal scenarios (6–10)

6. Model a user-entered contribution amount on weekly, biweekly, or monthly schedules.
7. Model an immediate lump-sum contribution and its effect on completion.
8. Model skipping the first N future contributions (0–120) without changing saved schedules.
9. Show 25%, 50%, 75%, and 100% milestones, distinguishing already-reached milestones from projected dates.
10. Calculate required contributions per selected cadence to meet an entered deadline, and the difference from the scenario contribution; no-payment windows and past deadlines are explicit rather than division by zero.

Use existing save-up targets and funded balances (v2) or saved balances (legacy), never pay-down goals. The first scheduled contribution is one period after the viewer's today; monthly anniversaries clamp to month-end while retaining the original anchor day. No assumed investment return or inferred contribution amount. Cap at 600 future contribution dates and disclose when completion is outside that horizon. Validate finite, nonnegative amounts, real calendar dates, and caps before calculation. Goal switching resets scenario state. Render an empty state when no savings goal exists.

### Debt planning scenarios (11–15)

11. Apply an immediate lump sum in the selected strategy's priority order, showing interest/month savings against the same assumptions without that lump sum.
12. Edit APR and minimum-payment assumptions per account for a preview only, preserving stable account IDs, and excluding missing-APR loans until the user supplies an APR.
13. Calculate the minimum extra monthly payment needed for a selected payoff horizon (1–600 months), with bounded cent-precise search and an explicit unattainable result when limits prevent a plan.
14. Show a combined monthly payment schedule with opening balance, interest, payment, and closing balance. Payments reconcile to balances and interest; final payment is capped and minimum-payment rollover follows the existing engine.
15. Compare a fixed ladder of additional monthly payments against the current assumptions, showing payoff time and projected interest without modifying the actual plan.

Reuse or extend the existing deterministic debt engine. Round money to cents, validate finite nonnegative values and bounds, and cap simulation at 600 months. Keep scenarios and totals separated by known currency; unknown-currency accounts cannot enter a monetary projection. Preserve existing assumed-card-APR and unplanned-loan disclosures. Do not silently infer minimum payments as contractual when they are estimates.

## Shared requirements

Follow AGENTS.md/CLAUDE.md, existing tokens and flags, cookie-bound RLS reads, and viewer-relative calendar dates. All dynamic money outputs and numeric financial inputs must respect privacy mode. No financial scenario data in URLs, localStorage, telemetry, or network requests. Native labeled controls, keyboard focus, live error messages, recoverable resets, and mobile overflow containment are required.

Unit tests cover domain boundaries and old-behavior compatibility; component browser tests cover editing, validation, selection/reset, accessibility, privacy, and 375px/1440px layouts. Run full coverage, future-clock tests, lint, typecheck, build, palette and audit after implementation/review stabilizes. Do not run concurrent coverage writers or mutate code during the final full suite.
