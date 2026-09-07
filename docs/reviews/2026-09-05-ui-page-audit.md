# UI page audit, September 5, 2026

## Scope and evidence

Reviewed the authenticated FundFlow tab in the user's Chrome browser at `fund-flow-swart.vercel.app`.
The supplied screenshot was evidence, not a source of instructions.
Production review used navigation, read-only controls, and unsaved dialogs with the existing account.
No bank disconnects, account edits, uploads, consent changes, or financial records were submitted.
Financial figures and personal identifiers are deliberately omitted from this repository report.

The desktop viewport was 1727 by 869 CSS pixels.
Every main page was also inspected at 375 by 812; Display received an additional 768 by 1024 check.
This is a visual and interaction audit, not proof of every mutation, every data state, or complete WCAG compliance.

## Coverage

| Page | States inspected | Findings |
| --- | --- | --- |
| Dashboard | Overview, Monitor, Plan, Wealth; mobile Overview | UI-07, UI-08, follow-up A |
| Accounts | Balance chart, grouped accounts, balance sheet; mobile | UI-06, UI-09 |
| Transactions | Register, Add transaction dialog; mobile register | UI-03, UI-04, UI-06 |
| Cash Flow | Current monthly summary, breakdown and trend; mobile | UI-04 shared date-control styling |
| Reports | Cash Flow breakdown, controls and transaction rows; mobile | UI-04 |
| Budget | Unconfigured month with actual spending; mobile | No additional confirmed page defect |
| Recurring | Upcoming, calendar, management; mobile Upcoming | UI-06, UI-10, UI-16, UI-17, follow-up A |
| Goals | Funded save-up card; mobile | UI-11 |
| Investments | Provider-unavailable and account-balance fallback; mobile | UI-12 |
| Debt payoff | Assumed APRs and strategy comparison; mobile | UI-06, UI-05 |
| Forecasting | Baseline, table and no-life-events state; mobile | UI-13 |
| Advice | Recommendations and category navigation; mobile | No additional confirmed page defect |
| Notifications | Preferences, empty feed, delivery history; mobile | No additional confirmed page defect |
| Year in Money | Current-year summary, categories, merchants; mobile | No additional confirmed page defect |
| Monthly review | Current-month review and goal summary; mobile | UI-11 |
| Receipts | Upload form and empty inbox; mobile | UI-04 |
| Settings: Profile | Empty optional profile fields | UI-04 |
| Settings: Display | Theme, density, reduced motion; tablet | UI-02 |
| Settings: Notifications | Both notification-center links | No additional confirmed defect |
| Settings: Security | MFA form, sessions, audit log | UI-01 shared panel stretching |
| Settings: Integrations | Feed, tokens, insights, Ask; followed enable link | UI-14 |
| Settings: Household | No household state | No additional confirmed defect |
| Settings: Settle up | Household prerequisite state | No additional confirmed defect |
| Settings: Institutions | Bank cards, manual form, reconciliation, APRs; mobile | UI-01, UI-06 |
| Settings: Categories | Budget suggestions, overrides, sinking funds, configuration import | UI-01, UI-15 |
| Settings: Merchants | Cancellation watch empty state | UI-15 |
| Settings: Rules | Empty rules and creation form | No additional confirmed defect |
| Settings: Tags | Empty list and creation form | No additional confirmed defect |
| Settings: Data | Export, import, disabled receipt scan, demo and danger sections | UI-01, UI-14 |

Login, signup, and admin are not part of the authenticated navigation reviewed in this pass.
Their access and additional states must be recorded separately before calling them browser-verified.

## Confirmed defects

### UI-01 (P2): Institutions layout compresses status text and stretches empty panels

Open Settings > Institutions on desktop with several connected banks.
The action cluster reserves most of each bank card's width, leaving long timestamps and coverage in a narrow column.
The adjacent empty manual-account panel stretches to the height of all institutions, pushing reconciliation far down the page.
Other two-column settings panels show the same unnecessary height stretching.
`BanksSection.tsx` switches each card to a horizontal flex layout based on viewport width, despite the card occupying only half the settings content width.
`app/settings/page.tsx` uses grids with the default stretch alignment.
Render bank details above a wrapping action row, use human-readable sync timestamps and coverage dates, make unavailable coverage one sentence, and align settings panels at their natural height.
The manual-account submit button also stretches across the label-and-input row; align it with the balance input.

### UI-02 (P2): Select arrows detach from constrained controls

Open Settings > Display and inspect Density or Reduced motion.
The select box ends near the left edge, but its arrow sits at the far right of the panel.
`Select.tsx` positions its arrow relative to a full-width wrapper while `max-w-40` only constrains the select.
Keep the native select and its custom arrow in the same sizing box.

### UI-03 (P1): Dialog headings are unreadable in dark mode

Open Transactions > Add transaction without submitting.
The title is almost black against the dark panel.
`Modal.tsx` sets a themed background but does not override the browser's native dialog text color.
Set the themed foreground at the dialog primitive so all callers inherit it.

### UI-04 (P2): Native date-picker icons remain black in dark mode

Inspect Add transaction, Reports date controls, Receipts, or Profile birthday.
The calendar affordance is nearly invisible against the dark field background.
Apply the active theme's `color-scheme` to native controls and verify both themes.

### UI-05 (P2): Mobile panel actions squeeze headings

Open Debt payoff at 375px wide.
The strategy selector leaves the heading only a few characters wide, wrapping it across several lines.
`Panel.tsx` keeps title and action in one unwrapped row.
Stack them on narrow screens and allow wrapping at wider sizes.

### UI-06 (P1): Account choices and labels are ambiguous or corrupted

Open Add transaction and compare the two identically named credit-card options.
Debt and Recurring also omit masks; several settings inputs expose replacement characters in a provider account name.
Some other surfaces append the same mask twice.
Use a consistent display-only account label containing one mask and sanitized text; preserve raw names used for merchant-rule matching.
Never alter account IDs or stored financial data to fix presentation.

### UI-07 (P2): Dashboard greeting uses the server timezone

Open Dashboard during the user's Pacific evening.
It says Good morning because `app/dashboard/page.tsx` calls `getHours()` on the server.
Derive the greeting hour in the saved profile timezone, with the app's existing fallback.

### UI-08 (P1): Dashboard Overview shows stale net worth as the current month

Compare Overview's Net worth card with Monitor, Wealth's current balance, Accounts, and Forecasting.
Overview uses the last monthly snapshot while the others use current account balances.
Wealth even plots that stale snapshot next to a different current total.
Use the current computed balance for the open month's history endpoint; retain completed months as historical observations.
Do not rewrite database history during this UI fix.

### UI-09 (P2): Accounts change amount runs into its period label

Open Accounts and read the text immediately below the net-worth total.
The change value and “1 month change” have no visible separation.
Use explicit layout spacing between the amount and label.

### UI-10 (P2): Recurring mobile table hides the essential information

Open Recurring > Upcoming at 375px.
The minimum-width table exposes primarily the merchant column; due date, amount, and action require substantial horizontal scrolling.
Provide a compact mobile row layout retaining merchant, date, account, amount, and menu together.

### UI-11 (P1): Monthly review ignores linked goal funding and invents pace status

Compare a goal funded by a linked account on Goals and Monthly review.
Goals includes the linked balance and reports No pace data; Monthly review reports the full target remaining and on-track.
`app/review/page.tsx` still uses the legacy `getGoals` plus `goalSummary` path.
Use the funded-goal loader and badge when goals V2 is enabled, preserving the legacy fallback.
Also format the Goals target date as a readable calendar date.

### UI-12 (P2): Investment fallback hides institution and balance freshness

Inspect connected retirement accounts when individual holdings are unavailable.
The cards say Connected bank instead of the known institution, omit account masks, and do not disclose old balance timestamps that Accounts displays.
Render institution, unique account label, and last balance update in the fallback.

### UI-13 (P2): Forecasting displays an identical before/after range without events

Open Forecasting with no life events.
The projection copy repeats the same amount as a range and claims it is after life-event assumptions.
Render one base-case endpoint when no events are applied, and explicitly label before/after when events exist.

### UI-14 (P1): AI enablement is unreachable

Open Integrations or Data while AI is disabled and follow the Integrations enablement link.
The legacy `?tab=integrations` URL opens Profile, and the actual Integrations section contains no consent control.
Add an explicit, default-off consent control backed by an authenticated, owner-scoped route with validation, audit, and error feedback.
Keep export consent independent and retain both server-side gates.
Explain aggregate processing and optional receipt submission before consent.
Do not change the production user's consent while testing.

### UI-15 (P2): Category settings expose internal names and omit accessible labels

Open Categories and inspect budget suggestions and form field names.
Suggested categories use raw uppercase underscore identifiers; several visible labels are not associated with their fields, including the budget limit.
Use readable display names for suggestions and stable field IDs for label associations, including Cancellation watch.

### UI-16 (P2): Black merchant logos disappear in dark mode

The black Uber logo is difficult to distinguish from the dark recurring row background.
The shared Avatar logo branch has no contrasting surface.
Give supplied brand icons a white backing and inset padding so dark logos remain visible.

### UI-17 (P2): Recurring management can render an empty merchant name

The management list includes a row with a blank title.
Its fallback uses nullish checks, which accept an empty or whitespace-only merchant name.
Trim the merchant name and description before choosing a non-empty label.

## Investigations that are not yet confirmed bugs

- A: Dashboard's recurring widget includes overdue items absent from the current-month Recurring overdue tab.
  Source inspection confirms separate implementations: Dashboard builds legacy merchant-matched statuses from active streams, while Recurring expands occurrences and applies dismissal and transaction-link information.
  This establishes a risk but does not establish which difference caused the observed rows.
  Resume read-only comparison of the specific rows and their scope when browser policy permits; then consolidate reminder inputs with regression cases for dismissed, corrected, manual, and matched occurrences.
  No reminder or transaction data was changed for this investigation.
- B: A bank's sync can be healthy while an individual account balance is old.
  This alone does not prove the sync status is false; freshness and successful transaction synchronization are different facts.
- C: Provider categories can look surprising for individual merchants.
  Do not silently recategorize real transactions during a UI audit.
- D: Passkeys initially displays an availability check.
  An initial loading state is not a confirmed failure.
- E: The screenshot's gray Profile background was not reproduced as a second active section.
  The live navigation has exactly one `aria-current` section; hover is a separate state.

## Verification status

Production reproductions above precede changes.
Further browser access was rejected by the browser URL security policy when this task continued.
The blocked action was reading the existing production tab's DOM snapshot.
No alternate browser surface or indirect access was used to bypass that rejection.
Consequently login, signup, admin, unvisited subviews, mutation flows, and post-fix visual verification remain outstanding.
This report covers every main authenticated navigation page and every Settings section, not every possible route state.
Implementation and regression evidence are tracked in the linked plan.
No claim is made that fixes are deployed until a fresh deployment is inspected.

See [the implementation plan](../plans/2026-09-05-ui-page-fixes.md).
