# Insights, rules, and transaction details

Group 3: 4.1, 4.2, 5.1, 5.2, 5.3, 6.1.
Base: `feat/import-foundation` (PR #198), needed for the raw provider descriptor.
No dependency updates, production migrations, flag flips, or merges are part of this PR.

## Checklist

- [x] 4.1 Eight explained insight generators and individual preferences.
- [x] 4.2 Priority feed with acknowledge and restore.
- [x] 5.1 Bounded compound rules preserving legacy semantics.
- [x] 5.2 Durable run history and transaction provenance.
- [x] 5.3 Suggested rule after recategorization, count preview and optional past application.
- [x] 6.1 Desktop detail pane and mobile sheet.

## Contracts and implementation decisions

Each feature has its own default-off flag.
Insights use canonical USD finance rows and existing recurring occurrences and funded goals.
They are in-app only; no new financial data is sent to push, email, or AI services.
The existing Notifications page becomes the insights feed when enabled, with server-authorized acknowledgement and restoration.
Insight preferences are user-authored fields on `alert_preferences`.

Compound rule conditions are nullable additive JSON on existing rules.
Null keeps legacy columns authoritative; explicit conversion preserves the amount predicate and matching semantics.
Groups support AND and OR, with at most three nested groups and twenty leaves.
Evaluation refuses batches that exceed a bounded work budget.
A rule uses the first matching position in the existing ordering.
New routes require cookie authentication, rate limits for evaluation/writes, strict validation, audit entries, and return 404 with their flag off.
API tokens are not accepted.
Run and change journals are service-writable, owner-readable with MFA and revocation RLS gates.
Failed runs stay visible without exposing provider errors or raw descriptors.

Full signed-in Supabase journeys remain deferred under the owner's approved exception.
Local unit, migration/RLS, responsive component browser, lint, type, and build checks will be recorded separately.
