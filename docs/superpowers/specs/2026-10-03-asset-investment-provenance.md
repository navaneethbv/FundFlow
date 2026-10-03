# Asset and investment provenance, checklist 9.3 through 9.6

This group builds on PR #205 without merging it or applying a production migration.
All new entry points remain disabled by default.

## Acceptance contract

- 9.3: link an owned property to an existing owned liability and a user-entered fixed-rate amortization schedule.
  Show dated equity from the property's owned value minus the liability, preferring a dated lender or manual observation over an estimate.
  Never write the equity back as an asset balance or subtract the liability again in net worth.
  The linked liability represents the user's recorded obligation, not a percentage inferred from property ownership.
  Fixed-rate terms use the existing amortization engine; variable-rate and off-cycle payment editing are not introduced here.
- 9.4: retain provider-reported basis separately from manual, imported-statement, or estimated annotations.
  An annotation is valid only for its recorded quantity.
  Zero is a valid basis; missing or stale basis remains unknown.
  Show value-weighted coverage for displayed holdings and label gains on incomplete coverage as partial.
- 9.5: show annualized money-weighted return alongside the existing time-weighted method for the same owner-account valuation window.
  Use dated external flows, a 365-day year, Newton iteration starting at 10 percent, and a bounded bisection fallback.
  Document deterministic root selection and warn that non-conventional flows may admit multiple roots.
  Unsupported currencies, missing observations, truncated reads, and an unbracketed/nonconvergent root produce unavailable, not zero.
  Recorded provider flows are not a guarantee of complete account history.
- 9.6: infer US tax-treatment categories from explicit Plaid account subtypes, with an owner override and an unknown bucket.
  Reuse the classification in Forecasting for included starting investment balances.
  Do not infer a tax rate, jurisdiction, liability, or after-tax return.

## Storage and API

Configuration is owner scoped, versioned, exported in takeout/backup, and excluded from automatic restore until owner-aware restore validation exists.
Cookie-bound reads enforce RLS, session revocation, and MFA.
Authenticated, rate-limited writes go through owner-scoped service RPCs with compare-and-swap versions.
No new endpoint accepts an API token.
Disabled flags prevent reads of unapplied tables.
An explicit reset removes a basis or tax override without modifying provider data.

## Verification

Use independent financial examples, hostile-owner and stale-version API/SQL tests, local disposable Postgres, synthetic browser fixtures, full repository checks, and exact-head hosted scanner results.
Synthetic fixtures do not establish real Supabase session acceptance.
Production migration, release, and signed-in production acceptance remain separate gates.

## Source verification

The financial algorithms and forms are original implementations, with no reference-project code, fixtures, or assets copied.
Behavior was checked against the pinned reference projects already recorded in the adoption review.
External contracts were checked against [Plaid account and investment schemas](https://plaid.com/docs/api/accounts/#investment-transaction-types-schema), [Plaid's combined buy/contribution explanation](https://support.plaid.com/hc/en-us/articles/40621176117271-Why-is-a-contribution-Investments-transaction-represented-as-an-outflow), and [the XIRR day-count convention](https://support.microsoft.com/en-us/excel/functions/xirr-function).
The new performance path handles buy/contribution as contributed capital, and refuses ambiguous cash/transfer activity instead of inventing its classification.
