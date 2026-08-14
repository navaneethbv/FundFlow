# FundFlow — Session Handoff

Last updated: 2026-08-14. Read this first to resume.

## In flight: PR #114, Sonar refactor plus its review fixes

`fix/form-control-accent-color` is an open PR that refactors the reported Sonar cognitive-complexity findings across 85 files.
Every check on it was green, Sonar's quality gate included, before the review below ran.
The last Sonar finding (S4323 on `app/api/goals/accounts/route.ts`) is fixed by extracting `NumericColumn`, `GoalBaselineRow`, and `AccountBaselineRow`.

A review of the diff against `main` found four behavior regressions the refactor introduced and the full suite did not catch.
Each one now has a test that was confirmed to fail without its fix.

**postgrest-js appends `order()` calls rather than replacing them.** Hoisting a shared query builder that baked in `.order("date")`/`.order("id")` made the ledger ignore `?sort=` entirely, because the requested sort landed behind the default. The builder is now split: `buildLedgerFilterQuery` is deliberately unordered, and `buildLedgerScanQuery` adds the fixed total order that `range()` chunking needs.

**`x` is a card-mask character and also a letter.** Unifying the two report mask strippers into `lib/account-label.ts` turned "Amex 1234" into "Ame". The helper now gives back letters borrowed from the end of a word, which also fixes `lib/report-pdf.ts`, broken this way before the refactor.

**A hand-written scanner replacing an email regex leaked PII.** `redactEmails` treated trailing punctuation as part of the domain, so `user@example.com!` failed the TLD check and passed through whole into the admin alert inbox and the logs. The span now ends at the last real `.tld`.

**Unanchored-looking trim quantifiers are part of the iCal feed's contract.** Narrowing `/^-+/` to `/^-/` in `lib/ical.ts` changes VEVENT UIDs for names with two or more leading or trailing non-alphanumerics, and a subscriber reads a changed UID as a second event. Both quantifiers are anchored, so there was never any backtracking to fix.

One more worth carrying forward: reading a deprecated SDK field through a computed key (`legacySession[["on","success"].join("_")]`) silences the deprecation rule by hiding the field from the compiler, grep, and static analysis at once.
A locally declared type expresses the same intent and keeps the read checked.

## Previous delivery: security hardening (PR #110)

A full-repository security review (`docs/CODE_REVIEW.md`, `docs/Security-Review.md`) and the fixes for every finding it raised: H1-H5, M1-M15, L1-L12, plus the Next.js 16.3.0 upgrade for the `sharp`/libvips CVEs.

All nine `supabase/migrations/20260810*` files are applied to the linked live Supabase project `zrxbmmtqqhlwtrinocww`.
The final migration, `20260810180000_recurring_streams_drop_client_write.sql`, was applied on 2026-08-10 before merge.
A post-apply migration dry run reports that the remote database is up to date.
Live verification confirms the guarded `recurring_streams_select_visible` policy remains and the unintended `recurring_streams_update_own` client-write policy is gone.
The database prerequisite for merging PR #110 is complete.

The live-only `public.rls_auto_enable()` event-trigger function is not created by this repository and remains executable by `PUBLIC`, `anon`, and `authenticated`.
Both `scripts/check-rls.sql` and the Supabase security advisor flag those grants.
This is a separate follow-up, not a PR #110 migration prerequisite, and it should be corrected through a checked-in migration or Supabase-managed configuration rather than an undocumented live-only change.

Two behavior changes worth remembering.
`/api/plaid/exchange` now requires a `link_token` in the body and consumes it single-use, so any caller other than `ConnectBankButton` has to send one.
The webhook route no longer honours the `NODE_ENV === "test"` bypass, so tests that need to skip signature verification must pin `PLAID_ENV=sandbox` with a non-production `NODE_ENV`; `tests/integration/webhook.test.ts` does this explicitly now.

## Previous delivery: a reported "web login is broken" that was never the app

The report was that web login was broken while mobile worked.
It was neither an auth defect nor a deployment defect.
The login page was rendering with its stylesheet missing, which looks like a broken app but leaves sign-in working underneath, and the cause was a **browser ad blocker** blocking the CSS request.

The diagnostic trap is worth carrying forward, because it cost most of the session.
A clean-engine reproduction passed at every step: `curl` fetched the stylesheet with a 200, and Playwright WebKit rendered the production page perfectly and completed a real sign-in attempt against live Supabase, returning "Invalid login credentials" for bad input.
Neither loads browser extensions.
**A passing Playwright or `curl` reproduction rules out the server and says nothing about the user's browser.**
When a page is unstyled in a real browser but fine in automation, suspect an extension before anything server-side, and ask for the user's own Network tab, where a blocked request reads as blocked rather than as a 404.
NordVPN Threat Protection was also active and served a malware block page for the domain, which was a convincing red herring; disabling it changed nothing.

Two unrelated defects were found while investigating and are fixed.

`/manifest.webmanifest` was returning a 307 to `/login` for signed-out visitors, because the proxy matcher excluded `sw.js` but not the manifest.
The browser then parsed a login page as JSON and reported that the manifest was not valid JSON data.
Verified by curl before and after; it now returns 200 with `application/manifest+json`.

`public/sw.js` precached `/`, `/login`, and `/signup` into a cache named by a hardcoded constant.
The activate handler only deletes caches whose name differs, so cleanup was a permanent no-op and those documents outlived every deployment, still pointing at `/_next` chunks that later deploys delete.
Precaching is removed, navigations are network-only, and only `response.ok` is cached, since `cache.put` will otherwise happily store a 404 and pin the failure.
This was a latent bug, not the reported one.

Two SonarQube findings on `proxy.ts` are resolved.
`PUBLIC_PAGE_PATHS` is now a `Set`, which required widening the source-parsing regex in `tests/unit/proxy.test.ts`; that guard was re-verified to still fail when a path is added to the allowlist.
S7780 (`String.raw`) is suppressed rather than applied, with the reason in a comment: Next statically analyzes `config.matcher` at build time and ignores anything that is not a plain literal, so a tagged template would silently disable the matcher and with it the `sw.js` and static-asset exclusions.

Documentation was restructured in the same pass, around one rule.
**`CLAUDE.md` is how to work in this repository; documentation is what the repository contains.**
It was 336 lines and had become a repository manual, which competes for attention with the actual task every session.
It is now 117 lines and holds only rules.

Everything descriptive moved out verbatim, so nothing was lost.
`docs/ARCHITECTURE.md` is new and holds the request path, the full `lib/` module catalogue, the two-Supabase-clients detail, and the subsystem invariants in long form.
`docs/PALETTE.md` is new and holds the ΔE and contrast measurements behind the chart-palette rules.
`CLAUDE.md` keeps the short imperative version of each rule and points at both.

Keep that split when adding to either file.
A new module's description belongs in `docs/ARCHITECTURE.md`; only a rule that changes how someone works belongs in `CLAUDE.md`.

`CLAUDE.md` also gained the service-worker and proxy-matcher invariants it had never recorded, plus the reproduction rule from this session's failure: `curl` and Playwright load no browser extensions, so a green run there rules out the server and proves nothing about the reporter's browser.
`README.md` gained a Troubleshooting section covering the unstyled-page symptom, and `docs/QA.md` gained an ordered procedure for diagnosing "the app looks broken" reports.

## Previous delivery: every approved shipped-defect phase is implemented

Branch `fix/shipped-defects`, PR #99.
The reviewed plan is `~/.claude/plans/create-a-plan-on-toasty-treehouse.md`.

Phase A repairs the PWA identity, restores an environment kill switch for default-on feature flags, removes false security claims, makes the seven-slot dark chart palette pass the repository validator, and restores a clean lint boundary.
Phase B1 repairs the legacy browser baseline and the UI defects it exposed.
Phase C completes persistent private receipts, grouped dashboard budgets, investment day movement and movers, institution branding, bundled goal artwork, and OFX/QFX import preview.
Phase D adds debt payoff planning, recurring sinking funds, persisted cross-source duplicate review, Supabase passkeys, and multiple named TOTP factors as the recovery path.
The unusable custom backup-code table was removed because Supabase Auth does not expose backup-code consumption as an authentication factor.
Passkeys retain the existing server-side AAL2 invariant, so an account with verified TOTP still receives the TOTP step-up after passkey sign-in.

The five new migrations are applied to the linked live Supabase project.
Production Auth has passkeys enabled for `fund-flow-swart.vercel.app` with the canonical HTTPS origin.
The institution backfill updated all six live Plaid items, including four available logos and six brand colours.

Browser coverage now uses disposable live-Supabase users and deterministic finance fixtures.
It covers the completed feature journeys, the primary-route responsive matrix at 375, 430, 768, and 1440 pixels in both themes, collapsed and expanded shell states, the account menu, and 26 reviewed desktop visual baselines.

Two test-harness traps are worth knowing before writing more specs.
Playwright's default `caret: "hide"` on `page.screenshot()` mutates inline styles and races hydration on the next reload, so visual captures use `caret: "initial"`.
`getByLabel` substring-matches, so a bare `"History"` or `"Owner"` collides with sparkline labels and with the signed-in user's own email address.

### Post-review repair pass

A review of the finished branch found nine defects, all fixed on the same branch; `docs/QA.md` records each one.
The two worth carrying forward as rules rather than as fixed bugs:

Pairwise colour separation and surface contrast are independent properties, and passing one says nothing about the other.
The first dark re-step cleared every pairwise gate in `scripts/validate_palette.js` and still left three of seven slots under WCAG's 3:1 non-text minimum against the dark panel, because the validator only measured ΔE between series.
It now gates both, the dark set was re-stepped again to clear both at the light palette's own hues, and light `--viz-2`/`--viz-3` are carried as two named exceptions.
That exception list is a ratchet: never extend it to make a re-step pass.

A payoff plan keyed debts by display name, and account names are not unique.
Anything that joins a computed result back to its source rows must key on the id.

Phase C1 also shipped without the RLS integration test its plan required.
`tests/integration/receipts-rls.test.ts` now proves cross-user isolation over both the row and the Storage object, including that no client has a write path and that the object is reachable only through a server-minted signed URL.

One approved-plan deviation is worth knowing: Phase D4 called for one-time backup codes, and the branch removed the custom backup-code store instead.
The reasoning is recorded in the PR and in `docs/TODO.md` — Supabase Auth does not expose backup-code consumption as an authentication factor, so multiple named TOTP factors are the supported recovery path.
That was a deliberate substitution, not an oversight, but it is a scope change from the reviewed plan.

## Previous delivery: transaction sorting and staged filters

The Transactions page now has explicit Search, Date, Filters, and one shared Sort popover across desktop and mobile.
Date, account, category, subcategory, merchant, money direction, and account type changes are staged locally until Apply, while search applies on Enter or its Search button.
Applied chips, Clear filters, pagination, browser history, column state, and saved views all preserve the normalized ledger URL contract.
Date and displayed signed amount use deterministic database ordering, while merchant, category, and account sort the complete rule-adjusted display projection before selecting each 50-row page.
The previous silent 4,000-row rule-aware cutoff is gone, failed chunks no longer appear as successful empty results, and every financial query remains explicitly owner-scoped.
No migration or exchange-rate handling was added because this ledger is USD-only.

Verification passed with repository-wide lint, TypeScript, unit tests, the production build, and `tests/e2e/transactions.spec.ts` against a disposable Supabase user with 56 seeded transactions.
The browser journey covered all five sort fields in both directions, complete ordering across two pages, merchant-rule display values, staged Apply behavior, saved-view restoration, Back and Forward, client navigation without reload, mobile controls, Escape handling, and focus restoration.

## Older sessions

Finished phase programs and session notes from 2026-07-05 through 2026-08-09 are
in [`archive/HANDOFF-2026-07-to-08.md`](archive/HANDOFF-2026-07-to-08.md).
Nothing there is pending.
