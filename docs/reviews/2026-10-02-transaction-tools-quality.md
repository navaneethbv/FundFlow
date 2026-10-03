# Transaction tools quality follow-up, 2026-10-02

[PR #204](https://github.com/navaneethbv/FundFlow/pull/204) contains grouped adoption items 5.4 to 5.6 and 6.5 to 6.7.
Its corrective commit `a405b24` passed hosted CI, migration/RLS verification, smoke tests and Sonar's quality gate.
Sonar still reported one stateless-helper scope finding, and Codacy returned action required.

The scope finding is corrected by moving the categorization result formatter outside the component.
The owner supplied the current Codacy log, which identifies two further ESLint crashes and the repeated transaction-page Opengrep timeout.

## Reproduction and correction

The local `security-node/detect-unhandled-async-errors` rule reproduces the null-handler crashes in manual-account creation and scheduled-transaction submission.
The component functions used a direct `try/finally` without a catch, which this rule dereferences as though a catch always exists.
Four failing action regressions also reproduced rejected form submissions without user-visible feedback.

Manual-account creation now preserves its draft and reports a rejected request.
Scheduled save now preserves the open editor and draft on rejection.
Scheduled cancellation also checks HTTP failures, preserves the existing row, displays an alert outside the closed editor, and releases its busy state.
Successful cancellation still reloads and refreshes.
The two affected files pass the same ESLint rule without disabling it.

Local Opengrep 1.30.0 was run with the GitLab `rules_lgpl_javascript_redirect_rule-express-open-redirect` rule and the wrapper's ten-second per-rule limit.
Before the split, the transaction page took 8.27 seconds and produced a partial-parse warning.
Moving its existing owner-filtered data loaders into `app/transactions/_lib/ledger-page-data.ts` and its desktop row renderer into `components/transactions/LedgerTableRow.tsx` reduced the page's local rule run to 0.27 seconds.
All three resulting files scanned without errors or findings.
These are local timings; the hosted analyzer version and runtime are not established by the supplied log.
Eleven moved function bodies were compared with the previous commit and are byte-identical.
No query, owner filter, date calculation, page size, review rule or ledger markup changed in that extraction.
Existing UI and privacy assertions follow the relocated renderer.

## Broader analyzer blocker

The same rule was run locally across 560 production source files.
It crashes on 22 additional pre-existing files listed below.
A rule crash alone does not prove that the application's rejection handling is wrong; some library functions intentionally propagate errors to their callers.
Those call contracts must be inspected before changing them.
The owner was asked whether to handle this broader cleanup in a separate maintenance PR, include it here, or defer it and keep the next checklist pending.
No security rule has been disabled and no changes to these additional files are included in this follow-up.

- `app/api/plaid/webhook/route.ts`
- `components/advice/TaskChecklist.tsx`
- `components/goals/GoalsManager.tsx`
- `components/investments/AddManualHoldingForm.tsx`
- `components/notifications/InAppPreferences.tsx`
- `components/recurring/PriceSpikeBanner.tsx`
- `components/settings/AskAiSection.tsx`
- `components/settings/AuditLogSection.tsx`
- `components/settings/BudgetsSection.tsx`
- `components/settings/CardAprSection.tsx`
- `components/settings/DemoDataSection.tsx`
- `components/settings/DisplaySection.tsx`
- `components/settings/ProfileSection.tsx`
- `components/settings/ReceiptScanSection.tsx`
- `components/settings/SessionsSection.tsx`
- `components/settings/SettleUpSection.tsx`
- `components/settings/SinkingFundsSection.tsx`
- `components/settings/TagsSection.tsx`
- `components/transactions/AddTransactionModal.tsx`
- `components/transactions/BulkTagBar.tsx`
- `lib/plaid-service.ts`
- `lib/sync.ts`
