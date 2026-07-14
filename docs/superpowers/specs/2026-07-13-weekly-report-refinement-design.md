# Weekly report refinement (2026-07-13)

The first weekly report to actually reach an inbox exposed four presentation
problems. This spec covers the fixes. No schema change, no new query.

## 1. Card labels carry no institution

`buildWeeklyReport` labels cards with the raw Plaid `account.name`
(`lib/weekly-report.ts`). Plaid returns `"CREDIT CARD"` for one of the Chase
cards, so the report printed a row literally titled `CREDIT CARD` for $1,041.34,
the largest card line on the page.

**Rejected: reuse `detectCardDesign` from `lib/card-design.ts`.** It does not
solve this (`"CREDIT CARD"` falls through every branch to `name || "Credit
Card"` and comes back unchanged) and it actively mislabels: `"Blue Cash
Preferred®"` (Amex) matches its `includes("preferred")` branch and is renamed
`"Sapphire Preferred"` (Chase). That helper is a UI concern coupled to Tailwind
tokens, and it has a real bug. The report should not depend on it.

**Decision:** a pure `formatCardLabel(accountName, institutionName)` that always
prefixes the institution, joined with a middot.

- Title-case the account name **only when it is entirely uppercase**, so
  `CREDIT CARD` becomes `Credit Card` while `Platinum Card®` and `Blue Cash
  Preferred®` survive untouched.
- No institution: the name stands alone. No name: `"Credit card"`.

The report already builds `institutionById` for the bank breakdown, so the
institution is in hand. Labels are produced in the data layer, so this fixes the
**email and the PDF at once**.

Verified against real data: the three Chase cards sum to the Chase bank total
($1,324.17) and the two Amex cards to the Amex total ($31.52), so the prefixes
are correct.

## 2. The two breakdowns look additive but are not

Banks sum to the full week's spend ($1,485.69). Cards sum to $1,355.69, a
*subset* of the same money, because each card rolls up into its bank. Nothing on
the page says so. Add a line to the "Bank and card breakdown" subtitle stating
that card totals are already counted in their bank's total.

## 3. Page balance

Page 2 held three short sections. Move **Top merchants** to page 1 so page 1
carries the whole narrative (stats, categories, banks and cards, merchants).
Page 2 keeps budget pace and the checking/savings cash flow detail.

Budget pace stays even when empty; it reads as a nudge to configure budgets.

## 4. Invisible bars

A 1% category (Personal Care, $16.55) renders as a dot. Give bars a floor width
so small slices stay legible.

## Out of scope

The `Blue Cash Preferred® -> "Sapphire Preferred"` bug in `detectCardDesign`
is real and affects the dashboard card carousel, not this report. It needs its
own fix.

## Testing

Unit tests for `formatCardLabel` (uppercase normalization, missing institution,
missing name, names that must not be touched) and for the card aggregation in
`buildWeeklyReport`. Existing `report-pdf` tests must stay green.
