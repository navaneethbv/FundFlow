# FundFlow Monarch Alignment Implementation Prompt

You are implementing the approved FundFlow Monarch production-alignment program.

Work from the latest `origin/main` after the documentation PR containing these files has merged:

- `docs/Monarch-Production-Comparison-2026-08-29.md`
- `docs/superpowers/plans/2026-08-29-monarch-production-alignment.md`

Treat the comparison report as the evidence record and the implementation plan as the delivery contract.
Do not infer that any code is already implemented merely because a prior local prototype may exist.
Independently inspect the current code, reproduce each reachable defect, and validate every claim against the current branch before editing.

## Objective

Implement the plan in safe, reviewable phases until FundFlow can explain, repair, or explicitly classify each confirmed difference from Monarch.
Start with Phase 0 recurring correctness, then proceed through sync observability, repair and backfill, category alignment, configuration migration, holdings and bill synchronization, and selected experience parity.
Preserve FundFlow-specific strengths and do not copy Monarch branding or visual design.

## Required operating rules

- Read `AGENTS.md`, `docs/HANDOFF.md`, and the two alignment documents completely before changing code.
- If `graphify-out/graph.json` exists, query graphify before broad source exploration.
- Refer to the official Next.js documentation (https://nextjs.org/docs) before changing Next.js APIs or conventions.
- Begin each bug fix by reproducing the user-visible behavior in an E2E setting as closely as possible.
- Use test-driven development for confirmed defects: add a failing regression test, implement the smallest robust fix, then prove the test passes.
- Use actual authenticated Production data only for read-only acceptance when the user explicitly authorizes it.
- Never commit screenshots, account masks, transaction identifiers, email addresses, provider payloads, access tokens, or other real-account data.
- Scope every service-client query to the authenticated user.
- Add explicit pagination for any Supabase result set that can exceed 1,000 rows.
- Preserve raw Plaid categories and provider facts when adding user-facing overrides.
- Make every import previewable, idempotent, auditable, and conflict-aware.
- Do not invent holdings, bill data, provider health, credit scores, or successful synchronization.
- Do not weaken canonical transfer exclusions to force totals to resemble Monarch.
- Do not alter unrelated code except for a directly encountered failing test, lint defect, flaky test, or clearly broken UI required by repository policy.
- Do not commit `graphify-out/`, `lib/graphify-out/`, real-data artifacts, generated changelogs, or unrelated working-tree changes.
- Never add an agent identity as a commit co-author.

## Delivery sequence

Implement one coherent phase per pull request unless a phase must be split to keep review risk manageable.
Phase 0 must be the first implementation PR because it contains two demonstrated correctness defects.
Do not combine provider integrations, migrations, broad UI parity, and financial-domain changes into one oversized PR.

For every phase:

1. Confirm the exact `origin/main` starting commit and create a `codex/` feature branch.
2. Inspect current behavior, feature flags, schemas, migrations, and existing tests.
3. Record the reproduced user-visible failure or the verified capability gap.
4. Add focused failing tests before changing implementation behavior.
5. Implement the simplest complete solution that preserves one canonical financial projection.
6. Update the implementation plan checkboxes only for work demonstrated on that branch.
7. Run focused tests, lint, type checking, the full relevant test suites, a Production build, targeted E2E, accessibility checks, and visual regression checks where applicable.
8. Run `git diff --check` and `graphify update .`, while keeping generated graph output out of Git.
9. Self-review the exact diff for security, user scoping, pagination, idempotency, double counting, date handling, responsive behavior, and accessibility.
10. Push the branch and open a PR that states what is implemented, what remains, the exact verification evidence, migration or rollout requirements, and any provider-dependent limitation.

## Phase 0 minimum acceptance

- A recurring outflow charged to a credit account contributes to recurring Expenses rather than an invented credit-card bill total.
- Transfers and loan payments remain excluded.
- The credit-card summary remains empty or hidden until actual liability bill data exists.
- Dashboard selects and uses Plaid `predicted_next_date` for upcoming recurring items.
- An item due tomorrow appears in the next-seven-days widget.
- Dashboard and Recurring agree for the same stream.
- Deterministic fallback behavior remains when the provider has no prediction.
- Focused regressions, the complete unit and integration suite, lint, type checking, build, and targeted Dashboard and Recurring E2E all pass.

## Evidence and reporting standard

Separate these categories in every PR and status report:

- Confirmed application defect.
- Missing or stale source data.
- Independent configuration difference.
- Provider-dependent limitation.
- Product capability gap.

Passing tests are not proof of Production deployment or live-data parity.
Distinguish local completion, pushed commit, remote checks, preview acceptance, merged commit, Production deployment, and authenticated Production verification.
Do not say FundFlow is aligned with Monarch while source rows, configuration, or provider capabilities still differ.

## Required final handoff

Return:

- The PR URL and exact head commit.
- The phase and checklist items completed.
- Files and migrations changed.
- Tests and browser flows run, with exact results.
- Remote check status.
- Deployment and rollback notes.
- Remaining discrepancies classified by logic, data, configuration, provider, or product capability.
- Any uncertainty requiring the reviewer or product owner to decide.

Stop and ask before any destructive Production action, real-data mutation, provider purchase, new paid integration, or requirement choice that materially changes the approved plan.
