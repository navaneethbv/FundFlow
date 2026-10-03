# Collections, budgets, and manual assets

Group 7 contains 6.8, 7.1, 7.2, 7.3, 9.1, and 9.2.
The first four are already committed on `feat/budgets-collections-assets`.
The final two add property, vehicle, and other assets with explicit valuation history, growth assumptions, purchase details, and ownership.

## Asset contract

`POST /api/manual-assets` creates an asset or records a new valuation when `id` and `version` are supplied.
The authenticated session supplies the owner, with MFA and revocation enforcement through `requireUser`.
The body is bounded to 16 KiB and writes are rate limited to 60 per hour, failing closed.
Fields are `name`, `assetKind`, `value`, `valuationDate`, `valueSource`, `ownershipPercentage`, optional `purchasePrice` and `purchaseDate`, and optional `growth` with `kind` (percent or absolute), `amount`, `period` (month or year), and `startDate`.
All amounts are USD; entered values and purchase prices are nonnegative and less than one trillion dollars, with at most two decimals.
Ownership is greater than zero and at most 100 percent.
Growth compounds percent changes or adds absolute changes on completed anniversaries, anchored to the later of the valuation and growth start date, with month-end clamping and a 100-year limit.
Negative growth is allowed, with values floored at zero.
Future valuations and backdated changes preceding the latest entered valuation are rejected.
An update requires the current integer version; conflicts return 409, missing assets 404, invalid input 400, and unavailable features 404.
The response returns `{ id }` and is not cached.

Manual account balances retain the last entered owned share, so a flag rollback never starts counting somebody else's share.
The last entered gross value is preserved in `manual_assets.valuation_value` and the valuation history.
`manual_account_values` retains entered and estimated gross values, owned values, date, and provenance.
Estimates cannot replace manual or observed history and use the existing protected account-history writer.
An owner-scoped service-only RPC locks the manual account for valuation changes and materialization.
A security-invoker view projects the latest owned value to shared balance readers and labels estimated account values explicitly.
Settings edits continue to use raw names and values; typed assets are edited through the dedicated asset form.
Creation and daily snapshot processing materialize growth through the owner's current day.
There is no market-data provider, mortgage linkage, or change to provider balances in this batch.

`typedManualAssets`, `assetOwnership`, and `historyProvenance` must all be enabled for asset surfaces and processing.
All new flags remain off.
Migrations are additive and are not applied to production by this work.

## Verification

Validate request boundaries, conflict handling, growth arithmetic, month-end/leap anniversaries, owner isolation, estimate precedence, owned-share accounting, and saved/reloaded UI values.
Run repository lint, typecheck, coverage, production build, palette, synthetic browser fixtures, and disposable PostgreSQL migration/RLS checks.
Signed-in Supabase acceptance remains deferred under the existing owner-approved exception.
PR #204 currently fails the unchanged full dependency audit because `braces` 3.0.3 has no published fix for GHSA-vfj7-8cjw-p6xm; production-only audit passes.
