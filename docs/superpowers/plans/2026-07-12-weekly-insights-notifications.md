# Weekly Insights And Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an accurate, visual weekly spending email with a polished PDF attachment and a first-class Notifications page for user-controlled email and in-app preferences.

**Architecture:** Build one pure weekly report domain model that is populated by a user-scoped Supabase query and consumed by separate HTML email and PDF renderers. Add owner-readable delivery records for idempotency, keep SMTP delivery provider-neutral, and expose preferences plus recent alerts on `/notifications`.

**Tech Stack:** Next.js 16 App Router, TypeScript 6, React 19, Supabase Postgres and Auth, Nodemailer, PDFKit, Vitest, Vercel Cron.

## Global Constraints

- Use the previous Monday through Sunday in the user's configured timezone.
- Default timezone is exactly `America/Los_Angeles`.
- Target delivery is Monday at approximately 8:00 AM local time.
- Keep Nodemailer and the existing `SMTP_*` environment contract.
- Send only to the email on the Supabase Auth account.
- Weekly report and daily digest email are optional.
- Bank connection, sync-failure, and authentication/security messages are mandatory.
- Do not include individual balances, full account numbers, raw Plaid data, tokens, or transaction-level details.
- Use `monthly_limit * 12 / 52` for weekly budget allowance.
- Use inline email styles, table layout, no JavaScript, no external CSS, no remote chart images, and no tracking pixels.
- Keep all service-client reads and writes explicitly scoped by `user_id`.
- Add no new runtime dependency.
- Do not modify unrelated dashboard, Plaid, or authentication behavior.
- Never use U+2014 in source, tests, documentation, commit messages, or PR text.

---

### Task 1: Notification Preference And Delivery Schema

**Files:**
- Create with `supabase migration new weekly_insights_notifications`: the single new migration whose basename ends in `_weekly_insights_notifications.sql`
- Create: `tests/unit/weekly-report-schema.test.ts`
- Modify: `tests/integration/roadmap-rls.test.ts`

**Interfaces:**
- Consumes: existing `profiles`, `alert_preferences`, and `public.set_updated_at()`.
- Produces: `profiles.timezone`, `profiles.daily_digest_email_enabled`, and `weekly_report_deliveries` with unique `(user_id, period_start)`.

- [ ] **Step 1: Write the failing schema test**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("weekly insights schema", () => {
  it("stores delivery preferences and idempotent report attempts", () => {
    expect(sql).toContain("daily_digest_email_enabled boolean not null default true");
    expect(sql).toContain("timezone text not null default 'America/Los_Angeles'");
    expect(sql).toContain("create table public.weekly_report_deliveries");
    expect(sql).toContain("unique (user_id, period_start)");
  });

  it("allows owners to read delivery status without client writes", () => {
    expect(sql).toContain("weekly_report_deliveries_select_own");
    expect(sql).toContain("grant select on public.weekly_report_deliveries to authenticated");
    expect(sql).not.toContain("grant select, insert, update, delete on public.weekly_report_deliveries");
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm run test:unit -- tests/unit/weekly-report-schema.test.ts`

Expected: FAIL because the profile fields and delivery table do not exist.

- [ ] **Step 3: Create the migration through the Supabase CLI**

Run: `npx supabase migration new weekly_insights_notifications`

Expected: one new file ending in `_weekly_insights_notifications.sql`.

- [ ] **Step 4: Add the minimal schema**

```sql
alter table public.profiles
  add column if not exists timezone text not null default 'America/Los_Angeles',
  add column if not exists daily_digest_email_enabled boolean not null default true;

alter table public.profiles
  add constraint profiles_timezone_length
  check (char_length(timezone) between 1 and 80) not valid;

alter table public.profiles validate constraint profiles_timezone_length;

create table public.weekly_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('processing', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error_code text check (error_code is null or char_length(error_code) between 1 and 80),
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, period_start),
  check (period_end >= period_start)
);

create index weekly_report_deliveries_user_attempted_idx
  on public.weekly_report_deliveries (user_id, attempted_at desc);

alter table public.weekly_report_deliveries enable row level security;
grant select on public.weekly_report_deliveries to authenticated;

create policy "weekly_report_deliveries_select_own"
  on public.weekly_report_deliveries
  for select to authenticated
  using (user_id = (select auth.uid()));
```

- [ ] **Step 5: Extend the RLS integration test**

Add owner and cross-user SELECT assertions for `weekly_report_deliveries`. Insert fixtures through the admin client, verify the owner sees one row, and verify the second authenticated user sees zero rows.

- [ ] **Step 6: Run schema and RLS tests**

Run: `npm run test:unit -- tests/unit/weekly-report-schema.test.ts`

Expected: PASS.

Run: `npm test -- tests/integration/roadmap-rls.test.ts`

Expected: PASS when Supabase integration variables are present, otherwise SKIP.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/unit/weekly-report-schema.test.ts tests/integration/roadmap-rls.test.ts
git commit -m "feat: add weekly report delivery preferences"
```

### Task 2: Timezone-Aware Weekly Periods

**Files:**
- Create: `lib/report-period.ts`
- Create: `tests/unit/report-period.test.ts`

**Interfaces:**
- Consumes: a JavaScript `Date`, IANA timezone string, and optional target hour.
- Produces: `normalizeReportTimezone(timezone): string`, `getWeeklyReportPeriod(reference, timezone): WeeklyReportPeriod`, and `isWeeklyReportDue(reference, timezone, targetHour?): boolean`.

- [ ] **Step 1: Write failing period tests**

```ts
import { describe, expect, it } from "vitest";
import {
  getWeeklyReportPeriod,
  isWeeklyReportDue,
  normalizeReportTimezone,
} from "@/lib/report-period";

describe("weekly report periods", () => {
  it("returns the previous Monday through Sunday", () => {
    expect(getWeeklyReportPeriod(new Date("2026-07-13T15:00:00Z"), "America/Los_Angeles")).toEqual({
      start: "2026-07-06",
      end: "2026-07-12",
      previousStart: "2026-06-29",
      previousEnd: "2026-07-05",
    });
  });

  it("is due only during Monday's target local hour", () => {
    expect(isWeeklyReportDue(new Date("2026-07-13T15:30:00Z"), "America/Los_Angeles", 8)).toBe(true);
    expect(isWeeklyReportDue(new Date("2026-07-13T14:59:00Z"), "America/Los_Angeles", 8)).toBe(false);
  });

  it("falls back for invalid timezones", () => {
    expect(normalizeReportTimezone("not/a-zone")).toBe("America/Los_Angeles");
  });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `npm run test:unit -- tests/unit/report-period.test.ts`

Expected: FAIL because `lib/report-period.ts` does not exist.

- [ ] **Step 3: Implement pure timezone helpers**

```ts
export const DEFAULT_REPORT_TIMEZONE = "America/Los_Angeles";

export interface WeeklyReportPeriod {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
}

export function normalizeReportTimezone(timezone: string | null | undefined): string;
export function getWeeklyReportPeriod(reference: Date, timezone: string): WeeklyReportPeriod;
export function isWeeklyReportDue(reference: Date, timezone: string, targetHour = 8): boolean;
```

Use `Intl.DateTimeFormat(...).formatToParts()` to read weekday, year, month, day, and hour in the user's timezone. Perform date addition on `YYYY-MM-DD` strings through UTC date arithmetic so daylight-saving changes cannot shift report dates.

- [ ] **Step 4: Add daylight-saving and non-Pacific cases**

Add tests for `America/New_York`, `Europe/London`, the March 2026 daylight-saving boundary, and Sunday UTC that is already Monday in the user timezone.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:unit -- tests/unit/report-period.test.ts`

Expected: PASS.

```bash
git add lib/report-period.ts tests/unit/report-period.test.ts
git commit -m "feat: calculate timezone-aware report weeks"
```

### Task 3: Reconciled Weekly Report Model

**Files:**
- Create: `lib/weekly-report.ts`
- Create: `lib/weekly-report-data.ts`
- Create: `tests/unit/weekly-report.test.ts`
- Modify: `tests/integration/reporting.test.ts`

**Interfaces:**
- Consumes: user-scoped transactions, accounts, institutions, budgets, merchant rules, splits, refund links, duplicate decisions, auth email, and `WeeklyReportPeriod`.
- Produces: `buildWeeklyReportModel(input): WeeklyReportData` and `getWeeklyReportData(supabase, userId, period): Promise<WeeklyReportData | null>`.

- [ ] **Step 1: Define fixture-driven failing tests**

```ts
const report = buildWeeklyReportModel({
  userId: "user-1",
  userEmail: "person@example.com",
  period,
  transactions,
  accounts,
  institutions,
  budgets,
  merchantRules,
  splits,
  linkedRefundTransactionIds: new Set(["charge-refunded", "refund"]),
  duplicateTransactionIds: new Set(["duplicate-confirmed"]),
});

expect(report.totalSpend).toBe(180);
expect(report.categories).toContainEqual({ category: "DINING", amount: 90, share: 0.5 });
expect(report.banks[0]).toMatchObject({ name: "Chase", amount: 120 });
expect(report.cards[0].name).not.toContain("4242");
expect(report.budgets[0].weeklyAllowance).toBeCloseTo(230.77, 2);
```

Cover first-match merchant rules, valid splits replacing parent categories, linked refunds excluded from spend, confirmed duplicates excluded, transfers excluded, and literal depository movement retained in cash flow.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm run test:unit -- tests/unit/weekly-report.test.ts`

Expected: FAIL because the model builder does not exist.

- [ ] **Step 3: Implement report types and pure aggregation**

```ts
export interface WeeklyReportData {
  userId: string;
  userEmail: string;
  period: WeeklyReportPeriod;
  totalSpend: number;
  previousTotalSpend: number;
  changeAmount: number;
  changePercent: number | null;
  categories: Array<{ category: string; amount: number; share: number }>;
  merchants: Array<{ merchant: string; amount: number }>;
  banks: Array<{ name: string; amount: number }>;
  cards: Array<{ name: string; amount: number }>;
  budgets: Array<{
    category: string;
    spent: number;
    weeklyAllowance: number;
    percentage: number;
    status: "on-track" | "at-risk" | "over";
  }>;
  cashFlow: { inflows: number; outflows: number; net: number };
}

export function buildWeeklyReportModel(input: WeeklyReportInput): WeeklyReportData;
```

Apply merchant rules with the existing `applyMerchantRules()` helper. Use `aggregateSpendWithSplits()` for active-week categories. Use account type to separate depository cash movement from spend. Card labels use product names only and never append masks.

- [ ] **Step 4: Implement the user-scoped data loader**

In `getWeeklyReportData`, call `auth.admin.getUserById(userId)` for the recipient and issue explicit `.eq("user_id", userId)` filters for every service-client query. Bound transaction reads from `period.previousStart` through `period.end`. Read only required columns.

For duplicate decisions, accept only `kind = 'duplicate'` and `decision = 'confirmed'`; treat `subject_id` as the transaction id chosen for exclusion by the existing duplicate review contract.

- [ ] **Step 5: Update integration fixtures and expectations**

Pass an explicit period to `getWeeklyReportData`. Add one merchant rule, one split transaction, and one linked refund pair. Assert the integration report matches the dashboard semantics and uses the Auth email.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:unit -- tests/unit/weekly-report.test.ts`

Run: `npm test -- tests/integration/reporting.test.ts`

Expected: unit PASS; integration PASS with configured Supabase or SKIP without it.

```bash
git add lib/weekly-report.ts lib/weekly-report-data.ts tests/unit/weekly-report.test.ts tests/integration/reporting.test.ts
git commit -m "feat: reconcile weekly report spending"
```

### Task 4: Visual Email And PDF Renderers

**Files:**
- Create: `lib/report-email.ts`
- Create: `lib/report-pdf.ts`
- Create: `tests/unit/report-email.test.ts`
- Create: `tests/unit/report-pdf.test.ts`
- Modify: `lib/reporting.ts`
- Modify: `app/api/export/report/route.ts`

**Interfaces:**
- Consumes: `WeeklyReportData`, dashboard URL, PDF Buffer, and recipient Auth email.
- Produces: `renderWeeklyReportEmail(data, dashboardUrl): { subject; html; text }`, `generateWeeklyReportPdf(data): Promise<Buffer>`, and `sendWeeklyReportEmail(data, pdfBuffer, dashboardUrl)`.

- [ ] **Step 1: Write failing email safety and content tests**

```ts
const rendered = renderWeeklyReportEmail(
  fixtureReport({ merchants: [{ merchant: '<img src=x onerror="alert(1)">', amount: 40 }] }),
  "https://fundflow.example/dashboard",
);

expect(rendered.html).toContain("Category breakdown");
expect(rendered.html).toContain("Banks and credit cards");
expect(rendered.html).toContain("Budget pacing");
expect(rendered.html).toContain("width:");
expect(rendered.html).toContain("&lt;img");
expect(rendered.html).not.toContain("<img");
expect(rendered.html).not.toContain("4242");
expect(rendered.text).toContain("Previous Monday through Sunday");
```

- [ ] **Step 2: Run the email tests to verify RED**

Run: `npm run test:unit -- tests/unit/report-email.test.ts`

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement HTML escaping and email-safe visual sections**

```ts
export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character]!);
}

export function renderWeeklyReportEmail(
  data: WeeklyReportData,
  dashboardUrl: string,
): { subject: string; html: string; text: string };
```

Use nested tables and inline `style` attributes. Horizontal bars must retain a visible text label and numeric value when background colors or CSS widths are unavailable. Clamp widths from 0 to 100 percent.

- [ ] **Step 4: Write failing PDF tests**

```ts
const buffer = await generateWeeklyReportPdf(fixtureReport());
expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
expect(buffer.length).toBeGreaterThan(5_000);
```

Also render a zero-activity fixture and an eight-category fixture to prove page flow does not throw.

- [ ] **Step 5: Implement the PDF renderer**

Move PDF-specific drawing out of `lib/reporting.ts`. Add focused helpers for section headings, KPI cards, proportional bars, page breaks, footer, and page numbering. Use only built-in PDFKit fonts.

- [ ] **Step 6: Centralize SMTP delivery**

Keep one transporter helper in `lib/reporting.ts`:

```ts
export async function createReportTransporter(): Promise<{
  transporter: ReturnType<typeof nodemailer.createTransport>;
  isDevelopmentPreview: boolean;
}>;

export async function sendWeeklyReportEmail(
  data: WeeklyReportData,
  pdfBuffer: Buffer,
  dashboardUrl: string,
): Promise<{ messageId?: string }>;
```

Pass `subject`, `html`, and `text` from the renderer. Attach `fundflow-weekly-${data.period.start}.pdf`. Continue refusing an Ethereal fallback in production.

Keep compatibility re-exports for `getWeeklyReportData` and `generateWeeklyReportPdf` from `lib/reporting.ts`. Update the on-demand export route to read the user's profile timezone, calculate the most recently completed weekly period, and pass that explicit period into `getWeeklyReportData`.

- [ ] **Step 7: Run tests and commit**

Run: `npm run test:unit -- tests/unit/report-email.test.ts tests/unit/report-pdf.test.ts`

Expected: PASS.

```bash
git add lib/report-email.ts lib/report-pdf.ts lib/reporting.ts app/api/export/report/route.ts tests/unit/report-email.test.ts tests/unit/report-pdf.test.ts
git commit -m "feat: render visual weekly email and PDF"
```

### Task 5: First-Class Notifications Page

**Files:**
- Create: `app/notifications/page.tsx`
- Create: `components/notifications/EmailPreferences.tsx`
- Move: `components/settings/NotificationsSection.tsx` to `components/notifications/NotificationFeed.tsx`
- Create: `components/notifications/InAppPreferences.tsx`
- Modify: `components/shell/AppSidebar.tsx`
- Modify: `components/ui/icons.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `components/settings/ReportsSection.tsx`
- Create: `tests/unit/notifications-page.test.ts`

**Interfaces:**
- Consumes: owner-scoped profile preferences, alert preferences, notification rows, delivery rows, and current Auth email.
- Produces: authenticated `/notifications`, reusable client preference components, primary navigation entry, and a Settings link.

- [ ] **Step 1: Write failing source-level UI tests**

```ts
expect(readFileSync("components/shell/AppSidebar.tsx", "utf8")).toContain('href: "/notifications"');
expect(readFileSync("app/notifications/page.tsx", "utf8")).toContain('active="notifications"');
expect(readFileSync("components/notifications/EmailPreferences.tsx", "utf8")).toContain("Weekly spending report");
expect(readFileSync("components/notifications/EmailPreferences.tsx", "utf8")).toContain("Daily financial digest");
expect(readFileSync("components/notifications/EmailPreferences.tsx", "utf8")).toContain("Always enabled");
expect(readFileSync("components/notifications/InAppPreferences.tsx", "utf8")).not.toContain("broken_bank");
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm run test:unit -- tests/unit/notifications-page.test.ts`

Expected: FAIL because the page and components do not exist.

- [ ] **Step 3: Add navigation and server page**

Extend `AppShellActive` with `"notifications"`, add a Mail icon navigation item, and build a server page that loads:

```ts
supabase.from("profiles").select("timezone, weekly_report_enabled, daily_digest_email_enabled")
supabase.from("alert_preferences").select("budget_exceeded, goal_reached, large_transaction, low_cash_forecast")
supabase.from("notifications").select("id, type, severity, title, body, read_at, created_at")
supabase.from("weekly_report_deliveries").select("period_start, period_end, status, attempted_at, sent_at")
```

All queries use the browser-bound server client and `.eq("id" or "user_id", user.id)` where the selected table supports it.

- [ ] **Step 4: Implement email preferences**

`EmailPreferences` upserts only the signed-in user's profile row. Validate timezone by constructing `Intl.DateTimeFormat("en-US", { timeZone })` before saving. Offer a bounded list containing at least Pacific, Mountain, Central, Eastern, UTC, London, and India timezones.

Render weekly and daily toggles plus disabled rows for mandatory bank/sync and security messages.

- [ ] **Step 5: Implement in-app preferences and feed**

Remove `broken_bank` from editable UI. Preserve it as `true` in the upsert payload. Keep budget, goal, large transaction, and low-cash controls. Reuse the existing optimistic mark-read behavior in `NotificationFeed`.

- [ ] **Step 6: Replace Settings panels with a link**

Remove the duplicated feed and alert preference queries from Settings. Keep `#reports` and `#alerts` as small panels that link to `/notifications`, preserving existing anchors.

- [ ] **Step 7: Run tests and commit**

Run: `npm run test:unit -- tests/unit/notifications-page.test.ts tests/unit/settings-roadmap-ui.test.ts tests/unit/settings-ui.test.ts`

Expected: PASS.

```bash
git add app/notifications components/notifications components/shell/AppSidebar.tsx components/ui/icons.tsx app/settings/page.tsx components/settings/ReportsSection.tsx tests/unit/notifications-page.test.ts tests/unit/settings-roadmap-ui.test.ts tests/unit/settings-ui.test.ts
git commit -m "feat: add notification preferences center"
```

### Task 6: Idempotent Weekly Delivery And Digest Preferences

**Files:**
- Create: `lib/report-delivery.ts`
- Create: `tests/unit/report-delivery.test.ts`
- Modify: `app/api/cron/weekly-report/route.ts`
- Modify: `app/api/cron/sync/route.ts`
- Modify: `tests/integration/reporting.test.ts`
- Modify: `lib/notifications.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: hourly trusted invocation, profile timezone and opt-ins, period helper, weekly data loader, renderers, SMTP sender, and `weekly_report_deliveries`.
- Produces: `claimWeeklyDelivery`, `markWeeklyDeliverySent`, `markWeeklyDeliveryFailed`, one-send-per-period behavior, optional daily digest, and mandatory broken-bank notifications.

- [ ] **Step 1: Write failing delivery state tests**

```ts
expect(classifyDeliveryClaim(null, now)).toBe("claim");
expect(classifyDeliveryClaim({ status: "sent", attemptedAt: now }, now)).toBe("skip");
expect(classifyDeliveryClaim({ status: "processing", attemptedAt: fiveMinutesAgo }, now)).toBe("skip");
expect(classifyDeliveryClaim({ status: "processing", attemptedAt: twoHoursAgo }, now)).toBe("retry");
expect(classifyDeliveryClaim({ status: "failed", attemptedAt: twoHoursAgo }, now)).toBe("retry");
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm run test:unit -- tests/unit/report-delivery.test.ts`

Expected: FAIL because the delivery helper does not exist.

- [ ] **Step 3: Implement delivery state transitions**

```ts
export type DeliveryClaim = "claim" | "retry" | "skip";
export function classifyDeliveryClaim(
  existing: { status: string; attemptedAt: string } | null,
  now: Date,
): DeliveryClaim;

export async function claimWeeklyDelivery(
  supabase: SupabaseClient,
  userId: string,
  period: WeeklyReportPeriod,
  now: Date,
): Promise<{ claimed: boolean; deliveryId?: string }>;
```

Insert the unique row for a first claim. On conflict, fetch only the same `user_id` and `period_start`; retry only failed or stale-processing rows by updating with an explicit user filter. Use a 60-minute stale threshold.

- [ ] **Step 4: Rewrite the weekly cron around due users and claims**

Accept an optional exported `runWeeklyReports(reference = new Date())` for deterministic integration tests. Fetch profiles with weekly opt-in, timezone, and user id. Do not require an active Plaid item so import-only users can receive reports.

For each due user: claim, load Auth email and report data, render PDF, send, record provider message id, and mark sent. Map known failures to safe codes such as `smtp_not_configured`, `pdf_render_failed`, and `email_send_failed`. Continue after individual failure.

- [ ] **Step 5: Respect digest opt-out and mandatory bank alerts**

Before daily digest delivery, query `profiles.daily_digest_email_enabled`. When enabled, send all notifications in the digest. When disabled, send only `broken_bank` notifications so bank connection and sync-failure email remains mandatory. Do not suppress any in-app notifications. In `createNotification`, force `broken_bank` to remain enabled even if a legacy preference row contains false.

- [ ] **Step 6: Update cron integration tests**

Mock the reference time at Monday 8:15 AM Pacific. Invoke the route twice and assert the first run sends one report and the second reports zero new sends. Add an opted-out profile and a second user whose sender throws; assert one user failure does not stop the successful user.

- [ ] **Step 7: Configure the requested scheduler**

Change the weekly cron expression to hourly:

```json
{
  "path": "/api/cron/weekly-report",
  "schedule": "0 * * * *"
}
```

Do not change the daily sync schedule. Document that this requires Vercel Pro or another trusted hourly scheduler.

- [ ] **Step 8: Run tests and commit**

Run: `npm run test:unit -- tests/unit/report-delivery.test.ts`

Run: `npm test -- tests/integration/reporting.test.ts`

Expected: unit PASS; integration PASS or environment-based SKIP.

```bash
git add lib/report-delivery.ts lib/notifications.ts app/api/cron/weekly-report/route.ts app/api/cron/sync/route.ts tests/unit/report-delivery.test.ts tests/integration/reporting.test.ts vercel.json
git commit -m "feat: deliver weekly reports idempotently"
```

### Task 7: Documentation, Artifact Inspection, And Full Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/QA.md`
- Modify: `docs/HANDOFF.md`
- Modify: `todos.md`
- Create: `scripts/render-weekly-report-fixture.test.ts`
- Create: `tests/unit/weekly-report-docs.test.ts`

**Interfaces:**
- Consumes: completed feature, fixture report data, and existing verification commands.
- Produces: deployment instructions, QA steps, representative HTML/PDF artifacts, and final green evidence.

- [ ] **Step 1: Write failing documentation tests**

```ts
expect(readFileSync("README.md", "utf8")).toContain("previous Monday through Sunday");
expect(readFileSync("README.md", "utf8")).toContain("Vercel Pro");
expect(readFileSync("docs/QA.md", "utf8")).toContain("Weekly email visual QA");
expect(readFileSync("docs/QA.md", "utf8")).toContain("America/Los_Angeles");
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm run test:unit -- tests/unit/weekly-report-docs.test.ts`

Expected: FAIL until documentation is updated.

- [ ] **Step 3: Update deployment and QA documentation**

Document SMTP setup, Auth-email delivery, timezone default, Monday-to-Sunday period, mandatory versus optional channels, hourly scheduler requirement, Vercel Hobby limitation, migration application, and rollback behavior.

Add QA checks for Gmail-compatible HTML structure, 600 px and 360 px widths, missing-data states, long merchant names, category bars, bank/card labels without masks, PDF attachment name, and duplicate cron invocation.

- [ ] **Step 4: Add a deterministic artifact renderer**

The script imports a fixed `WeeklyReportData` fixture, writes rendered HTML to `/tmp/fundflow-weekly-email.html`, and writes the PDF Buffer to `/tmp/fundflow-weekly-report.pdf`. It must not read `.env.local` or contact Supabase.

- [ ] **Step 5: Render and inspect the PDF**

Run: `npx vitest run scripts/render-weekly-report-fixture.test.ts`

Expected: both files are created in `/tmp`.

Use the bundled PDF tooling to render all pages to PNG. Inspect every page for clipping, overlap, missing labels, poor contrast, broken page transitions, footer placement, and page numbering. Fix the renderer and repeat until inspection shows no defects.

- [ ] **Step 6: Inspect email at wide and narrow widths**

Open the local fixture HTML at 600 px and 360 px viewport widths. Confirm readable bars, no horizontal scrolling, escaped merchant text, visible numeric values, and a usable dashboard link.

- [ ] **Step 7: Run the full repository gate**

Run: `npm run lint`

Run: `npm test`

Run: `npm run build`

Run: `git diff --check`

Expected: all commands PASS. Integration tests may SKIP only when their documented external environment variables are absent.

- [ ] **Step 8: Review generated artifacts for sensitive data**

Run searches against the fixture HTML and extracted PDF text for `access_token`, `PLAID_SECRET`, account masks, and raw transaction ids. Expected: no matches.

- [ ] **Step 9: Commit**

```bash
git add .env.example README.md docs/QA.md docs/HANDOFF.md todos.md scripts/render-weekly-report-fixture.test.ts tests/unit/weekly-report-docs.test.ts
git commit -m "docs: add weekly insights deployment and QA"
```

### Task 8: Branch Review, Push, And Pull Request

**Files:**
- Review: all files changed from `origin/main...HEAD`

**Interfaces:**
- Consumes: verified commits from Tasks 1 through 7.
- Produces: pushed `feat/weekly-insights-notifications` and a GitHub pull request with evidence and deployment notes.

- [ ] **Step 1: Review the complete diff**

Run: `git diff --stat origin/main...HEAD`

Run: `git diff --check origin/main...HEAD`

Run: `git status --short --branch`

Expected: only weekly insights, notifications, tests, migration, and scoped documentation changes are present; the worktree is clean.

- [ ] **Step 2: Confirm verification evidence is current**

Re-run any gate whose output is older than the final code change. Do not rely on pre-change test output.

- [ ] **Step 3: Push the branch**

Run: `git push -u origin feat/weekly-insights-notifications`

Expected: branch is available on GitHub.

- [ ] **Step 4: Open the pull request**

Use a title such as `feat: add visual weekly insights and notification preferences`.

The PR body must summarize report accuracy, HTML/PDF visuals, Notifications page, idempotency, schema migration, hourly scheduler requirement, privacy exclusions, and exact verification results.

- [ ] **Step 5: Verify PR checks**

Run: `gh pr checks --watch`

Expected: required GitHub Actions and Vercel checks pass. If Vercel rejects the hourly schedule because the project is on Hobby, report the deployment-plan constraint and do not weaken the approved per-user scheduling requirement without user approval.
