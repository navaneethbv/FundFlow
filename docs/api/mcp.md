# Read-only MCP API contract

The MCP route is disabled by default behind `mcpEndpoint`.
It accepts only a scoped `fft_` bearer token and never writes application data.

## `GET` or `POST /api/mcp`

`GET` uses query parameters.
`POST` uses the same fields in a JSON object.

- `resource`: `aggregates` (default) or `rows`.
- `start` and `end`: inclusive `YYYY-MM-DD` dates, defaulting to the latest six months.
- `category`: optional category filter, at most 80 characters.

The date range is limited to 366 days.

### `aggregates`

Requires the `mcp:aggregates` token scope.
The response contains only month/category totals and counts, category budgets,
recurring category/frequency totals, and a month-level net-worth trend.
Transaction ids, account ids, merchants, annotations, and receipt fields are
never returned.
Aggregate month/category groups contain at least three canonical non-transfer
transactions.

### `rows`

Requires the separately granted `mcp:export-rows` token scope.
It returns only the existing export contract: date, merchant, amount, and
category, and honors `profiles.ai_export_enabled`.

Unknown, revoked, expired, missing-scope, or legacy tokens are rejected.
Both resources are rate-limited and audited.

Success responses are `200`.
Unauthenticated or insufficient-scope requests are `401`, disabled or
export-disabled requests are `403` or `404` as applicable, invalid filters are
`400`, and rate-limited requests are `429`.
