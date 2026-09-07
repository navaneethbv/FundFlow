# UI audit implementation plan

Canonical findings: [September 5 UI audit](../reviews/2026-09-05-ui-page-audit.md).
Work branch: `codex/ui-page-audit`, based on `baae8d8` from the existing savings-rate branch.
Do not mix the previous savings-rate changes into a duplicate pull request.

## Phase 1: Shared presentation primitives

1. UI-03: add `text-foreground` to `components/ui/Modal.tsx`.
2. UI-04: align native input color-scheme with light, dark, and system theme in `app/globals.css`.
3. UI-02: use the native select arrow bound to the select itself in `components/ui/Select.tsx`, preserving form semantics and caller sizing.
4. UI-05: make `components/ui/Panel.tsx` headers stack on phones and wrap when needed.
5. UI-01: use natural panel heights in `app/settings/page.tsx`, full-width bank content above actions in `BanksSection.tsx`, shared date formatters, and a single unavailable-coverage message.
6. UI-16: give supplied logos a contrasting backing and inset padding in `components/ui/Avatar.tsx`.

Acceptance: dark dialog title and calendar icons remain visible, arrows stay inside the field at desktop/tablet/phone widths, panel titles remain readable, bank text has room, and empty manual-account cards do not stretch.
Verify layouts in both themes with real native controls and representative long bank names.

## Phase 2: Financial display consistency

1. UI-06: add or extend a pure display-label helper in `lib/account-label.ts`.
   Remove replacement characters only from display text, strip an existing trailing mask, append one actual mask, and retain the original text for matching.
   Apply it to Transactions account options, Debt data, Recurring account labels, Goals account choices, and Settings account props.
2. UI-08: reconcile the open month's `netWorthHistory` endpoint with `netWorthSnapshot` in `lib/dashboard.ts`.
   Keep historical months untouched and check Overview, Monitor, Wealth, and Accounts against the same current source.
3. UI-11: load funded goals in Monthly review behind `goalsV2`, use actual badge copy and remaining amount, and preserve the old deployment fallback.
4. UI-12: include institution name, mask, and balance timestamp in Investments fallback data and render them alongside balances.

Acceptance: same-name accounts remain distinguishable, raw rule matching is unchanged, current-month net worth agrees across surfaces, funded goals agree with Goals, and investment fallback discloses freshness without inventing holdings.
Regression tests must cover duplicate names, names with masks, corrupted text, historical versus current snapshots, linked save-up and pay-down goals, missing timestamps, and unavailable holdings.

## Phase 3: Navigation, language, and mobile usability

1. UI-07: derive the greeting hour from the saved timezone using `Intl.DateTimeFormat` and the existing timezone fallback.
2. UI-09: space the Accounts delta and period label explicitly.
3. UI-10: adapt the Recurring row presentation for small screens while retaining table headers and menus on desktop.
4. UI-13: distinguish a single forecast endpoint from a before/after event comparison.
5. UI-15: format suggested category names and connect visible labels to fields.
6. UI-17: trim Recurring management labels and fall back to the description or Unknown.
7. Complete follow-up A by comparing Dashboard recurring inputs with the occurrence source used by Recurring before making any reminder changes.

Acceptance: evening remains evening across UTC midnight, Recurring date/amount/actions are immediately reachable at 375px, empty forecasts do not claim changes, and category forms have meaningful accessible names.

## Phase 4: Restore explicit AI consent navigation

1. Add `app/api/settings/ai/route.ts` using `requireUser`, strict boolean validation, per-user rate limiting, cookie-bound upsert with the authenticated user ID, and an audit event.
2. Add an Integrations consent panel with default-off state, a deliberate save action, clear processing scope, independent export-consent explanation, busy state, and failure feedback.
3. Replace legacy AI links in `AskAiSection.tsx` and `ReceiptScanSection.tsx` with the canonical section and consent anchor.
4. Keep generation separately initiated; saving consent must not send financial aggregates or receipt images.
5. Verify denied auth, malformed input, rejected writes, disabled export consent, and enable/disable behavior in mocked tests.

Acceptance: users can find the control, understand it, deliberately save a preference, and see errors without a false success state.
Production consent remains unchanged during verification.

## Phase 5: Completion gates

- Run focused regressions for the changed calculations, route, and rendered components.
- Run lint, typecheck, unit suite, build, and palette validation.
- Update the knowledge graph with `graphify update .`; never commit generated graph output.
- Use Chrome against local or preview UI to verify the changed layouts and unsaved dialogs.
- Do not run credentialed database mutation tests against the real account or claim they passed from mocked tests.
- Record the dependency freshness result and any actual update separately from visual fixes.
- Update this plan with exact results, outstanding issues, and deployment status.

## Dependency check

`npm-check-updates` found a compatible simple-icons minor update plus major releases of Vitest, its coverage provider, ESLint, Nodemailer, Plaid, and TypeScript.
The major upgrades require separate compatibility validation and are not assumed safe from version numbers alone.

## Execution record

All 17 confirmed findings have source changes on the work branch.
They are implemented locally, not deployed or visually reverified.
Follow-up A remains an investigation because the browser policy prevents identifying the exact cause of the differing recurring rows.

### Regression evidence

- `tests/unit/account-label.test.ts`: duplicate names, actual masks, parenthesized masks, corrupted text, absent names, and preserving unrelated numeric suffixes.
- `tests/unit/greeting.test.ts`: Pacific evening across UTC midnight and winter offset boundaries.
- `tests/unit/dashboard-extra.test.ts`: current balances replace only the open month; completed historical observations remain intact.
- `tests/unit/monthly-review-server.test.ts`: funded save-up and pay-down summaries, accurate pace labels, and legacy feature-flag fallback.
- `tests/unit/investments-data.test.ts`: institution, masked name, balance, and timestamp mapping.
- `tests/unit/ai-consent-route.test.ts`: auth denial, actual owner scoping despite a supplied foreign ID, explicit enable/disable, malformed JSON and values, rate-limit denial, and failed persistence.
- Existing recurring rendering, settings rendering, account rendering, AI double-consent, and privacy tests are included in the full regression run.

### Commands and release gates

Run from the repository root:

```sh
npm run lint
npm run typecheck
npx vitest run tests/unit scripts --coverage
npm run build
npm run validate:palette
graphify update .
```

Do not use `npm test` or credentialed integration/E2E tests against the real Supabase project.
Database tests require a disposable project and the existing `TEST_SUPABASE_URL` safeguard.
No schema changes were introduced, no migrations were applied, and no current deployment or migration ledger claim is made.

Browser policy blocked further DOM inspection of the production tab.
Post-fix desktop/mobile light/dark visual checks, unsaved dialog checks, login/signup/admin inspection, and the exact recurring mismatch remain required before calling the entire audit complete.
Do not substitute successful compilation or mocked tests for those browser checks.

### Dependency result

Updated `simple-icons` from 16.29.0 to 16.30.0; installation reported no vulnerabilities.
Major toolchain and provider SDK upgrades were left unchanged because they need their own compatibility review.
This task does not claim those major releases were tested or found incompatible.


### Completed automated checks

- Focused consent, labels, greeting, rendering, investment mapping, and Dashboard checks: 98 passed.
- Additional funded-review and balance-history checks: 64 passed.
- Full unit suite: 447 files, 4,946 tests passed.
- Unit plus script coverage run: 448 files, 4,947 tests passed.
- Coverage: statements 97.99%, branches 95.05%, functions 98.22%, lines 99.04%; all 95% thresholds passed without lowering them.
- ESLint and TypeScript checks passed.
- Production build passed.
- Palette validation passed with its existing documented contrast and color-distance exceptions.
- Knowledge graph update passed; generated graph outputs remain untracked and excluded.
- `git diff --check` passed.

### Handoff

Changes are local on `codex/ui-page-audit`.
No production deployment, push, or pull request was created in this task.
Resume at the browser release gates above; do not re-run the production audit by a method that bypasses the URL-policy rejection.

### Follow-up verification (2026-09-06)

Re-verified all 17 fixes on `codex/ui-page-audit` and applied four small robustness tweaks: guard the open-month history replacement when no accounts exist (UI-08), complete the no-events forecast copy (UI-13), add a base `color-scheme: light dark` fallback (UI-04), and give the Panel title wrapper `min-w-0 flex-1` (UI-05).
Focused suites: 9 files, 132 tests passed.
Full unit plus script coverage run: 448 files, 4,947 tests passed.
Coverage: statements 97.99%, branches 95.06%, functions 98.22%, lines 99.04%; all 95% thresholds passed.
ESLint, typecheck, production build, palette validation, and `git diff --check` passed.
Dependency check (`npx npm-check-updates`): only major bumps remain (Vitest/coverage v5, ESLint 10, Nodemailer 10, Plaid 47, TypeScript 7); left unchanged pending separate compatibility review.

### Independent review (2026-09-05, second pass)

Re-verified all 17 findings against the branch diff rather than the execution
record. Thirteen were correct as implemented. Five defects were found and
fixed; four of them were surfaces the original pass missed, not regressions in
what it changed.

- UI-06, three unconverted surfaces. `app/dashboard/page.tsx` still built
  account labels as `**<mask>` by hand, and `lib/dashboard.ts` did the same in
  `spendPerCard` and `buildDebtSummary`. None sanitized the provider name or
  stripped a mask the name already carried, so the audit's corrupted-text and
  doubled-mask cases survived on Dashboard, Monitor spend-per-card, and the
  Dashboard debt insight. The last one also disagreed with the Debt payoff
  page, which `lib/debt-data.ts` had already fixed. All three now use
  `accountDisplayLabel`. `buildDebtSummary` keeps its "Card" fallback for an
  unnamed credit account rather than inheriting the helper's generic
  "Account".
- UI-11, badge copy still diverged. Monthly review re-derived the label with
  `titleCase(badge)`, producing "On Track" and "At Risk" where `GoalCard`
  renders "On track" and "At risk" for the same goal. The mapping is now a
  single exported `GOAL_BADGE_LABEL` in `lib/goals-v2.ts` that both surfaces
  read, which also removes the duplicated `no-pace` special case.
- UI-03, three dialogs missed the primitive-level fix. `Modal.tsx` got
  `text-foreground`, but `CommandPalette`, `GoalWizard`, and
  `MobileNavigation` open their own `<dialog>` and still inherited the UA
  `CanvasText`. The UI-04 `color-scheme` change happens to mask this today;
  these no longer depend on it.
- `BudgetsSection` used `titleCase(suggestion.category)` as a React key. The
  key is back to the raw category, which is the stable identifier; only the
  rendered text is title-cased. The insert action always used the raw value,
  so no stored category was affected.

Verified as correct without change: UI-01, UI-02, UI-04, UI-05, UI-07 (hour
extraction returns 0 at midnight on this runtime, and an invalid stored
timezone falls back rather than throwing), UI-08 (`currentMonth` is the real
month, not the selected one, so completed months stay historical), UI-09,
UI-10, UI-12 (`accounts.plaid_item_id` -> `plaid_items` is a real FK, so the
embed resolves), UI-13, UI-14 (`ai_settings` carries the insert and update
policies the cookie-bound upsert needs, both MFA- and revocation-gated),
UI-15, UI-16, UI-17.

Gates after the fixes: lint, `tsc --noEmit`, 447 unit files / 4,947 tests,
448 files / 4,948 tests with scripts and coverage (statements 97.99%,
branches 95.05%, functions 98.22%, lines 99.04%, all thresholds met),
production build, and palette validation all passed. Browser verification of
the changed layouts is still outstanding, exactly as recorded above.

### Verification pass (2026-09-06, third pass)

Re-reviewed the second pass against a running browser rather than against its
own record, and closed out the browser verification it left open. Most of it
held up; three items did not and were corrected.

- **`ThemeToggle` lazy-init reverted.** Seeding `useState` from
  `document.documentElement.dataset.theme` reads the DOM during the hydration
  render, so a light-mode user's server HTML (`aria-label="Switch to light
  mode"`, knob `translate-x-4`) disagreed with the first client render.
  Reproduced on `/login` with `fundflow-theme=light`: React logged "A tree
  hydrated but some attributes of the server rendered HTML didn't match the
  client properties ... This won't be patched up", naming `<ThemeToggle>` and
  diffing exactly those two attributes. Because React does not patch attribute
  mismatches, the change did not even achieve its goal (the knob stayed in the
  dark position) while adding a console error to every light-mode page load.
  State is back to the SSR-safe `"dark"`; the existing deferred effect
  corrects it a tick later. Re-checked after the revert: console clean, and
  the toggle still settles to `translate-x-0` / "Switch to dark mode". The
  token normalization in the same hunk was kept, because `--surface-border`
  and `--panel-border` hold identical values in both themes: a rename, not a
  re-skin.
- **`Button` `size="sm"` height reverted.** `min-h-9` dropped every small
  button to 36 px, under the 44 px minimum that `docs/QA.md` checks and that
  `docs/superpowers/archive/specs/2026-08-02-monarch-visual-parity-design.md`
  calls non-negotiable. No defect was filed about `sm` being too tall. If the
  compact look is wanted later, the repo's own idiom is a breakpoint guard
  (`min-h-11 sm:min-h-9`), which keeps phones at 44 px.
- **Debt mobile card, two fixes.** Its privacy-blur hooks wrapped the labels
  along with the numbers, so `data-privacy="blur"` left three unlabelled
  smudges where the desktop table keeps its column heads; the hooks now wrap
  the number only. The account name also used `truncate`, which ate the
  trailing mask - the only thing telling two cards from the same bank apart -
  so it wraps instead, matching the `truncate` -> `break-words` change this
  same pass made on Wrapped and Monthly review.

Checked and kept: `Field`'s `useId` fallback (every consumer is a client
component, so the hook is legal, and the generated ids do land on the rendered
hint/error nodes); the `Badge`/`var(--viz-neg)` removal (Badge's danger tone
is a solid fill with a matched foreground, so the inline override was the
contrast bug); `use-dialog-focus` holding Tab (correct trap behaviour, and
`Modal` now carries the `tabIndex={-1}` it needs); `Modal`'s scroll lock
(restores the prior value, so nested dialogs unwind correctly); and the
`Tabs`, `BudgetsSection`, and `GOAL_BADGE_LABEL` key/copy fixes.

Layouts were verified by rendering `BudgetTable`, `HoldingsTable`, and
`DebtPlannerView` to static markup against the compiled stylesheet at 390 px
and 320 px: no page-level horizontal overflow at either width, and the only
clipped nodes are deliberate `truncate` and `sr-only`. Gates after the
corrections: lint, `tsc --noEmit`, 447 files / 4,948 unit tests, production
build, and palette validation all pass.
