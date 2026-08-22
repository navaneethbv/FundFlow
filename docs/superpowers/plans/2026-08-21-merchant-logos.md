# Merchant Logos and Brand Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a recognizable logo on ledger rows, the dashboard's Recent Activity widget, and merchant drilldowns for merchants FundFlow has a curated logo for, falling back to the existing deterministic initial disc everywhere else — no live scraper, no new external CSP host, mirroring the institution-logo feature's architecture exactly.

**Architecture:** A `merchant_logos` table stores validated base64 PNG logos keyed by normalized merchant name, populated from a curated dataset via a one-off backfill script (the same shape as `scripts/backfill-institution-logos.ts`) rather than a live third-party lookup. `MerchantAvatar` gains an optional `logoUrl` prop it doesn't have today, resolved the same `institutionLogoDataUri`-style validation the institution feature already uses, and the resolution happens **after** `applyMerchantRules` runs so a rule-renamed merchant ("SQ *COFFEE" → "Coffee Bar") looks up its logo by the display name the user actually sees.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres, Vitest.

**Spec:** `/Users/navaneethbv/Desktop/Projects/FundFlow/features.md` §8 ("Merchant logos and brand enrichment").

## Global Constraints

- No new CSP host: `img-src 'self' data: https:` already covers a base64 data URI (the pattern this feature uses) and any external image host, so this feature needs zero CSP changes — confirm this stays true rather than reaching for an external logo CDN that would need one.
- No live scraper or third-party lookup service at request time — logos come from a curated, versioned dataset applied via an offline backfill script, matching the project's explicit prior decision (`docs/superpowers/specs/2026-08-09-deferred-features-design.md` ruled out a live favicon/logo lookup service).
- A logo must never break row layout at 375px or with the compact density setting — this is a visual/readability feature, not a data-correctness one, so a malformed or oversized logo must fail closed to the initial-disc fallback, never a broken `<img>` or a layout shift.
- Reuse `institutionLogoDataUri`-style validation (base64 charset, PNG magic-number signature, size cap) rather than trusting stored data blindly at render time — defense in depth even though the backfill script validates on write.
- Route handlers (the backfill script itself runs outside the request path, so this mostly doesn't apply here, but any admin-triggered re-run route must still follow it): `requireAdmin()` → work → JSON, wrapped so failures hit `errorResponse`.
- Create migrations with `npx supabase migration new <slug>`; apply by hand before code reads the table.
- Tests mock with `vi.mock` where a route is involved; pure functions get direct unit tests.
- `npm run lint`, `npm test`, and `npm run build` must pass before this is done.

---

### Task 1: Add the merchant_logos schema

**Files:**

- Create with Supabase CLI: migration slug `merchant_logos`
- Modify: `tests/unit/roadmap-schema-completion.test.ts` (or the nearest schema-assertion test file)

**Interfaces:** `merchant_logos` is a **global, non-user-scoped** table (a logo for "Starbucks" is the same PNG for every user, unlike everything else in this app) — read-only to `authenticated`, writable only by `service_role` (the backfill script), which is a deliberate deviation from the owner-scoped-RLS default and worth calling out explicitly since it's unusual in this codebase.

- [ ] Write failing schema tests asserting: `merchant_logos` has columns `id, merchant_key, display_name, logo_base64, brand_color, source, created_at, updated_at` with `unique (merchant_key)`; RLS enabled with `select` granted to `authenticated` and `anon` revoked, but `insert`/`update`/`delete` **not** granted to `authenticated` at all (only `service_role`, which bypasses RLS, can write — matching the "no client mutation path" precedent `linked_duplicates` sets, since this table has no per-user ownership concept to check).
- [ ] Run the focused test and confirm failure.
- [ ] Generate the migration:
  ```sql
  create table public.merchant_logos (
    id            uuid primary key default gen_random_uuid(),
    merchant_key  text not null unique,
    display_name  text not null,
    logo_base64   text not null,
    brand_color   text,
    source        text not null default 'curated',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  );

  create index merchant_logos_merchant_key_idx on public.merchant_logos (merchant_key);

  create trigger merchant_logos_set_updated_at
    before update on public.merchant_logos
    for each row execute function public.set_updated_at();

  alter table public.merchant_logos enable row level security;
  revoke all on public.merchant_logos from anon;
  grant select on public.merchant_logos to authenticated;

  create policy "merchant_logos_select_all" on public.merchant_logos
    for select to authenticated using (true);
  ```
  `merchant_key` is a normalized lookup key (lowercased, whitespace-collapsed merchant name — see Task 2's normalizer), not the raw display string, so lookups are resilient to case/spacing differences between how a merchant name is stored on a transaction versus in the curated dataset.
- [ ] Apply the migration and verify the table, grants, and RLS.
- [ ] Run the focused schema test again and confirm it passes.
- [ ] `merchant_logos` is global reference data, not user data — do **not** add it to `USER_DATA_TABLES` in `lib/user-data.ts` (it has no `user_id` and doesn't belong in a per-user backup/takeout).
- [ ] Commit with `feat(merchant-logos): add merchant_logos schema`.

### Task 2: Implement the merchant-key normalizer and logo validator

**Files:**

- Create: `lib/merchant-logos.ts`
- Create: `tests/unit/merchant-logos.test.ts`

**Interfaces:** `normalizeMerchantKey(name: string): string` and `validateMerchantLogo(value: unknown): string | null` — the latter is a direct generalization of `lib/plaid-institution.ts::validateInstitutionLogo`, reused rather than re-derived so both features share one definition of "what counts as a safe stored PNG."

- [ ] Write failing tests: `normalizeMerchantKey` lowercases, trims, and collapses internal whitespace runs to a single space (`"  Starbucks   Coffee "` → `"starbucks coffee"`); `validateMerchantLogo` accepts a well-formed base64 PNG (valid charset, correct magic-number prefix, round-trips losslessly) and rejects malformed base64, a non-PNG magic number, and anything over the size cap — same three checks `validateInstitutionLogo` already makes, proving this is a faithful reuse rather than a divergent copy.
- [ ] Run `npx vitest run tests/unit/merchant-logos.test.ts` and confirm failure.
- [ ] Implement `normalizeMerchantKey` in `lib/merchant-logos.ts`. For `validateMerchantLogo`, either import and call `validateInstitutionLogo` directly from `lib/plaid-institution.ts` (simplest — the two checks are identical) or, if institution-specific naming in that module makes reuse awkward, extract the shared magic-number/size/round-trip logic into a small shared helper both modules call; prefer direct reuse unless the extraction is genuinely cleaner.
- [ ] Run the test again and confirm it passes.
- [ ] Commit with `feat(merchant-logos): add merchant key normalization and logo validation`.

### Task 3: Build the curated dataset and the backfill script

**Files:**

- Create: `data/merchant-logos.json` (or `scripts/data/merchant-logos.json` — place it wherever the repo's other curated data assets live; check for a `data/` convention before creating a new one)
- Create: `scripts/backfill-merchant-logos.ts`

**Interfaces:** The dataset is a flat JSON array of `{ merchantKey: string; displayName: string; logoBase64: string; brandColor: string | null; source: string }` entries (pre-normalized keys, so the script does no name matching at runtime — matching happens once, when the dataset is curated, not on every backfill run). The script itself mirrors `scripts/backfill-institution-logos.ts`'s shape closely enough that a future maintainer recognizes the pattern immediately.

- [ ] Curate a small initial dataset (10-30 common merchants is a reasonable v1 scope — Starbucks, Amazon, Target, Walmart, Costco, Uber, Netflix, Spotify, and similar high-frequency merchants — sourced from a legitimately licensable/public-domain icon set, never scraped from a live brand's site at build time) as `logoBase64` values already validated against `validateMerchantLogo` offline before committing them.
- [ ] Implement `scripts/backfill-merchant-logos.ts`: read the dataset file, `createClient(supabaseUrl, secretKey)` (service role, matching `backfill-institution-logos.ts`'s connection setup), `upsert` each entry into `merchant_logos` on `merchant_key` conflict, validate each `logoBase64` with `validateMerchantLogo` before writing (skip and count as `failed` on validation failure rather than writing invalid data, matching the institution script's `updated`/`skipped`/`failed` reporting shape), and print a final JSON summary the same way `backfill-institution-logos.ts` does.
- [ ] Run the script against a local/dev Supabase project and confirm the reported counts match the dataset size with zero `failed` entries.
- [ ] Commit with `feat(merchant-logos): add curated dataset and backfill script`.

### Task 4: Resolve merchant logos after rule application and wire into MerchantAvatar

**Files:**

- Modify: `lib/planning.ts` (the `applyMerchantRules`/`previewMerchantRules` neighborhood)
- Modify: `components/ui/Avatar.tsx`
- Create: `tests/unit/merchant-avatar-logos.test.ts`

**Interfaces:** `resolveMerchantLogos(merchants: string[], logosByKey: Map<string, MerchantLogoEntry>): Map<string, string>` (merchant display name → data URI, or absent when no match) — a pure function so the "resolve after rules, by display name" ordering rule from the plan's architecture section is directly testable, not just true by construction of where it's called.

- [ ] Write failing tests: `resolveMerchantLogos` looks up each merchant name via `normalizeMerchantKey` against the provided map and returns a data URI (via the same `institutionLogoDataUri`-style wrapping — generalize that helper in `components/ui/Avatar.tsx` to accept an arbitrary base64 string rather than only the institution prop shape, or add a sibling `merchantLogoDataUri` alongside it) only for merchants present in the map; a merchant name that only matches after `applyMerchantRules`'s renaming (e.g. `"Coffee Bar"`, the rule's `displayName`, not the raw `"SQ *COFFEE"`) resolves correctly when the test passes the *post-rule* name in, proving the "resolve after rules" ordering is what the function expects, not an accident of caller behavior.
- [ ] Run `npx vitest run tests/unit/merchant-avatar-logos.test.ts` and confirm failure.
- [ ] Implement `resolveMerchantLogos` in `lib/planning.ts` next to `applyMerchantRules`.
- [ ] Add an optional `logoUrl?: string | null` prop to `MerchantAvatar` in `components/ui/Avatar.tsx` (it already forwards to the shared internal `Avatar` the same way `InstitutionAvatar` does — this is a small, additive change, since `Avatar`'s `logoUrl`-vs-fallback branch already exists and `MerchantAvatar` simply never passed the prop before now).
- [ ] Run the test again and confirm it passes.
- [ ] Commit with `feat(merchant-logos): resolve logos after merchant-rule renaming`.

### Task 5: Wire resolved logos into every MerchantAvatar render site

**Files:**

- Modify: `app/transactions/page.tsx` (ledger row)
- Modify: `components/transactions/MobileLedgerList.tsx`
- Modify: `components/dashboard/RecentActivity.tsx`
- Modify: `components/dashboard/widgets/RecurringWidget.tsx`
- Modify: `components/recurring/RecurringList.tsx`
- Modify: `lib/dashboard.ts` (fetch `merchant_logos` once per request and thread it through)

**Interfaces:** Each page/component that currently renders `<MerchantAvatar name={...} />` with no `logoUrl` gains one, sourced from a `Map<string, string>` built once per request (via `resolveMerchantLogos`) and threaded down as a prop — never a per-row Supabase query, to avoid an N+1 pattern across a ledger page with hundreds of rows.

- [ ] In `lib/dashboard.ts::getDashboardData`, fetch all `merchant_logos` rows once (this table is small and global, so a single unscoped `select` is appropriate — no `user_id` filter needed or possible, since the table has none) and build the `logosByKey` map, then call `resolveMerchantLogos` against the set of merchant names already present in the dashboard's canonical transactions, threading the resulting `merchantLogoByName: Map<string, string>` onto whatever the dashboard data shape already exposes to its consumers.
- [ ] Do the equivalent one-time fetch-and-resolve in `app/transactions/page.tsx`'s server-side data load (the ledger page doesn't currently go through `getDashboardData`, so it needs its own small fetch-and-resolve, not a second call into the dashboard loader) and thread `merchantLogoByName` down to `LedgerTableRow` and `MobileLedgerList`.
- [ ] Update each render site (`LedgerTableRow`, `MobileLedgerList`, `RecentActivity`, `RecurringWidget`, `RecurringList`) to pass `logoUrl={merchantLogoByName.get(row.merchant) ?? null}` (or the equivalent field name at each site) into its existing `<MerchantAvatar>` call.
- [ ] Verify by hand in the dev server against demo data seeded with at least one merchant name from the curated dataset (e.g. rename a demo transaction's merchant to `"Starbucks"`): that row renders the real logo everywhere `MerchantAvatar` appears; an unmapped merchant still renders the existing initial disc unchanged; a logo doesn't break row layout at 375px or with the compact density setting; light/dark themes.
- [ ] Commit with `feat(merchant-logos): render resolved logos across ledger and dashboard`.

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] Run `npm run lint`, `npm run test:unit`, and `npm run build`; fix anything this feature introduced.
- [ ] Manually verify the three acceptance criteria from `features.md` §8: mapped merchants render logos, unmapped merchants render the existing initial disc unchanged; no new external host was added to the CSP (`diff` `proxy.ts`'s `buildCsp` against its pre-feature version and confirm it's untouched); a logo never breaks row layout at 375px or with the compact density setting (screenshot-check both).
- [ ] Update `docs/HANDOFF.md` and `docs/TODO.md`.
