# Remaining Must-Haves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three remaining deferred gaps: session revocation enforced on page renders, cron-failure alert email to the admin, and a bounded mobile polish pass.

**Architecture:** Revocation is enforced in `proxy.ts` (the existing auth chokepoint) via a pure lookup helper; cron alerts reuse the existing nodemailer transport and Postgres rate limiter; mobile polish adds a card-list twin for the ledger table plus touch-target and overflow fixes, verified by screenshots.

**Tech Stack:** Next.js 16 App Router (TypeScript), Supabase (`@supabase/ssr`, service client), nodemailer, Tailwind 4, Vitest.

Spec: `docs/superpowers/specs/2026-07-16-remaining-must-haves-design.md`.

## Global Constraints

- Branch: `feat/remaining-must-haves` (already created).
- Never use the em dash character (U+2014) in any output or code.
- Amount sign follows Plaid: positive = money out, negative = money in.
- Service-client queries must filter `user_id` (or `id` for profiles) explicitly.
- No PII, balances, or transaction detail in any email; error strings only.
- All gates must stay green: `npm run build`, `npm run lint`, `npm run test:unit`.
- Tests mock modules with `vi.mock` and import route handlers directly.
- This is Next.js 16: consult `node_modules/next/dist/docs/` if any API looks unfamiliar; `proxy.ts` is the Next 16 middleware replacement and runs on the Node runtime.

---

### Task 1: Extract the session-id decode into a pure helper

**Files:**
- Create: `lib/session-token.ts`
- Modify: `lib/http.ts:23-37` (refactor `currentSessionId` to use it)
- Test: `tests/unit/session-token.test.ts`

**Interfaces:**
- Produces: `decodeSessionId(accessToken: string | null | undefined): string | null` (pure, no imports, safe for proxy and tests).
- `currentSessionId` keeps its existing signature; `tests/unit/http.test.ts` must stay green.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/session-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decodeSessionId } from "@/lib/session-token";

function makeToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

describe("decodeSessionId", () => {
  it("returns the session_id claim from a JWT payload", () => {
    expect(decodeSessionId(makeToken({ session_id: "abc-123" }))).toBe("abc-123");
  });

  it("returns null when the claim is missing or not a string", () => {
    expect(decodeSessionId(makeToken({}))).toBeNull();
    expect(decodeSessionId(makeToken({ session_id: 42 }))).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(decodeSessionId(null)).toBeNull();
    expect(decodeSessionId(undefined)).toBeNull();
    expect(decodeSessionId("")).toBeNull();
    expect(decodeSessionId("not-a-jwt")).toBeNull();
    expect(decodeSessionId("a.%%%%.c")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/session-token.test.ts`
Expected: FAIL (cannot resolve `@/lib/session-token`).

- [ ] **Step 3: Write the implementation**

Create `lib/session-token.ts`:

```ts
/**
 * Decode the `session_id` claim from a Supabase access token (JWT). The
 * payload is decoded without signature verification, so callers must only
 * pass tokens that getUser() has already validated. Format-agnostic
 * (base64url JSON regardless of signing algorithm); null on malformed input.
 */
export function decodeSessionId(
  accessToken: string | null | undefined,
): string | null {
  const payload = accessToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return typeof claims.session_id === "string" ? claims.session_id : null;
  } catch {
    return null;
  }
}
```

In `lib/http.ts`, add the import and replace the body of `currentSessionId` (keep its doc comment, adjusting the second sentence to mention `decodeSessionId`):

```ts
import { decodeSessionId } from "@/lib/session-token";

export async function currentSessionId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return decodeSessionId(session?.access_token);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/session-token.test.ts tests/unit/http.test.ts`
Expected: PASS, including the pre-existing http tests.

- [ ] **Step 5: Commit**

```bash
git add lib/session-token.ts lib/http.ts tests/unit/session-token.test.ts
git commit -m "refactor(auth): extract session-id decode into a pure helper"
```

---

### Task 2: Revocation lookup helper

**Files:**
- Create: `lib/session-revocation.ts`
- Test: `tests/unit/session-revocation.test.ts`

**Interfaces:**
- Consumes: `decodeSessionId` from Task 1.
- Produces: `isSessionRevoked(supabase: SupabaseClient, userId: string): Promise<boolean>`; fails open (returns false) on any error. Task 3 calls this from `proxy.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/session-revocation.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { isSessionRevoked } from "@/lib/session-revocation";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeToken(sessionId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ session_id: sessionId }),
  ).toString("base64url");
  return `h.${payload}.s`;
}

function mockClient(opts: {
  accessToken?: string | null;
  revokedAt?: string | null;
  lookupError?: boolean;
  noRow?: boolean;
}): SupabaseClient {
  const maybeSingle = vi.fn(async () => {
    if (opts.lookupError) throw new Error("db down");
    if (opts.noRow) return { data: null, error: null };
    return { data: { revoked_at: opts.revokedAt ?? null }, error: null };
  });
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle,
  };
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: opts.accessToken ? { access_token: opts.accessToken } : null,
        },
      })),
    },
    from: vi.fn(() => chain),
  } as unknown as SupabaseClient;
}

describe("isSessionRevoked", () => {
  it("returns true when the session record is revoked", async () => {
    const client = mockClient({
      accessToken: makeToken("s1"),
      revokedAt: "2026-07-16T00:00:00Z",
    });
    expect(await isSessionRevoked(client, "u1")).toBe(true);
  });

  it("returns false for an active session record", async () => {
    const client = mockClient({ accessToken: makeToken("s1"), revokedAt: null });
    expect(await isSessionRevoked(client, "u1")).toBe(false);
  });

  it("returns false when no record exists (fresh login not yet recorded)", async () => {
    const client = mockClient({ accessToken: makeToken("s1"), noRow: true });
    expect(await isSessionRevoked(client, "u1")).toBe(false);
  });

  it("returns false when the session id cannot be decoded", async () => {
    const client = mockClient({ accessToken: null });
    expect(await isSessionRevoked(client, "u1")).toBe(false);
  });

  it("fails open on lookup errors", async () => {
    const client = mockClient({
      accessToken: makeToken("s1"),
      lookupError: true,
    });
    expect(await isSessionRevoked(client, "u1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/session-revocation.test.ts`
Expected: FAIL (cannot resolve `@/lib/session-revocation`).

- [ ] **Step 3: Write the implementation**

Create `lib/session-revocation.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeSessionId } from "@/lib/session-token";

/**
 * True when the current request's session has been revoked from the Settings
 * device list. Fails OPEN (false) on any lookup problem: a transient DB error
 * must not lock the user out of the whole app. Enforcement mirrors
 * requireUser() in lib/http.ts, which gates APIs; this gates page renders.
 */
export async function isSessionRevoked(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sessionId = decodeSessionId(session?.access_token);
    if (!sessionId) return false;
    const { data: record } = await supabase
      .from("user_session_records")
      .select("revoked_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .maybeSingle();
    return Boolean(record?.revoked_at);
  } catch {
    return false;
  }
}
```

Note: no `"server-only"` import; the module must stay importable by `proxy.ts` and by unit tests. It holds no secrets.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/session-revocation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/session-revocation.ts tests/unit/session-revocation.test.ts
git commit -m "feat(auth): add revoked-session lookup helper"
```

---

### Task 3: Enforce revocation on page renders in proxy.ts

**Files:**
- Modify: `proxy.ts` (import block, and the redirect logic around lines 109-137)

**Interfaces:**
- Consumes: `isSessionRevoked(supabase, userId)` from Task 2.
- Produces: revoked sessions get `signOut({ scope: "local" })` plus a redirect to `/login` on their next page navigation. No API-path behavior changes.

- [ ] **Step 1: Add the check to proxy.ts**

Add the import at the top of `proxy.ts`:

```ts
import { isSessionRevoked } from "@/lib/session-revocation";
```

In `proxy()`, the existing code computes `mfaPending`, then destructures `pathname`/`isApi`. Insert between the `const isApi = ...` line and the redirect block:

```ts
  // Session revocation: a device revoked in Settings must lose page access on
  // its next navigation, not only API access (requireUser already gates
  // those). One indexed RLS-scoped lookup per protected page render; the
  // helper fails open. signOut(local) invalidates this session's refresh
  // token and queues its cookie clears on `response` via the setAll plumbing.
  let sessionRevoked = false;
  if (user && !mfaPending && !isApi && !isPublicPage(pathname)) {
    sessionRevoked = await isSessionRevoked(supabase, user.id);
    if (sessionRevoked) {
      await supabase.auth.signOut({ scope: "local" });
    }
  }
```

Then change the redirect condition from:

```ts
  if ((!user || mfaPending) && !isApi && !isPublicPage(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    applySecurityHeaders(redirect, csp);
    return redirect;
  }
```

to:

```ts
  if ((!user || mfaPending || sessionRevoked) && !isApi && !isPublicPage(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    // signOut() queued its cookie clears on `response`; carry every pending
    // cookie onto the redirect or the revoked session keeps its auth cookies.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    applySecurityHeaders(redirect, csp);
    return redirect;
  }
```

(The cookie copy is a no-op for the plain unauthenticated/MFA redirects, which queue no cookie changes.)

- [ ] **Step 2: Verify gates**

Run: `npx tsc --noEmit && npm run lint && npm run test:unit`
Expected: all green; no unit test imports `proxy.ts` today, so nothing new to mock.

- [ ] **Step 3: Manual verification (requires dev server)**

1. `npm run dev`, sign in from two browsers (or one normal + one private window).
2. In browser A: Settings, revoke browser B's session.
3. In browser B: navigate to `/dashboard`. Expected: redirect to `/login`, auth cookies cleared (check DevTools Application tab).
4. In browser B: sign in again. Expected: normal access (new session id, new record).

If dev credentials or a second device are unavailable at execution time, note it and defer to the Task 8 QA session, which has a browser open anyway.

- [ ] **Step 4: Commit**

```bash
git add proxy.ts
git commit -m "feat(auth): enforce session revocation on page renders"
```

---

### Task 4: Cron alert email helper

**Files:**
- Modify: `lib/reporting.ts` (append one function)
- Create: `lib/cron-alert.ts`
- Test: `tests/unit/cron-alert.test.ts`

**Interfaces:**
- Consumes: `createMailTransport` / `logDevelopmentPreview` (module-private in `lib/reporting.ts`, hence the send function lives there), `checkRateLimit(key, max, windowSeconds)` from `lib/rate-limit.ts`, `createServiceClient`, `logError`.
- Produces:
  - `sendCronAlertEmail(toEmail: string, cronName: string, summary: CronAlertSummary)` in `lib/reporting.ts`.
  - `alertCronFailure(cronName: string, summary: CronAlertSummary): Promise<void>` and `interface CronAlertSummary { failed: number; total: number; firstError?: string }` in `lib/cron-alert.ts`. Task 5 calls `alertCronFailure` from both cron routes. It never throws.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cron-alert.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockSendCronAlertEmail = vi.fn();
vi.mock("@/lib/reporting", () => ({
  sendCronAlertEmail: (...args: unknown[]) => mockSendCronAlertEmail(...args),
}));

const mockGetUserById = vi.fn();
const profilesChain = {
  select: vi.fn(() => profilesChain),
  eq: vi.fn(() => profilesChain),
  limit: vi.fn(),
};
const mockServiceClient = {
  from: vi.fn(() => profilesChain),
  auth: { admin: { getUserById: (...args: unknown[]) => mockGetUserById(...args) } },
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { alertCronFailure } from "@/lib/cron-alert";

describe("alertCronFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
    profilesChain.limit.mockResolvedValue({
      data: [{ id: "admin-1" }],
      error: null,
    });
    mockGetUserById.mockResolvedValue({
      data: { user: { email: "admin@example.com" } },
    });
    mockSendCronAlertEmail.mockResolvedValue({ messageId: "m1" });
  });

  it("emails the admin with the cron name and summary", async () => {
    await alertCronFailure("daily-sync", { failed: 2, total: 5, firstError: "ITEM_LOGIN_REQUIRED" });
    expect(mockCheckRateLimit).toHaveBeenCalledWith("cron-alert:daily-sync", 1, 86400);
    expect(mockSendCronAlertEmail).toHaveBeenCalledWith(
      "admin@example.com",
      "daily-sync",
      { failed: 2, total: 5, firstError: "ITEM_LOGIN_REQUIRED" },
    );
  });

  it("skips when the 24h dedupe window is consumed", async () => {
    mockCheckRateLimit.mockResolvedValue(false);
    await alertCronFailure("weekly-report", { failed: 1, total: 1 });
    expect(mockSendCronAlertEmail).not.toHaveBeenCalled();
  });

  it("logs and skips when no admin profile exists", async () => {
    profilesChain.limit.mockResolvedValue({ data: [], error: null });
    await alertCronFailure("daily-sync", { failed: 1, total: 1 });
    expect(mockSendCronAlertEmail).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith("cron-alert.no-admin", expect.any(Error));
  });

  it("logs and skips when the admin has no email", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: { email: null } } });
    await alertCronFailure("daily-sync", { failed: 1, total: 1 });
    expect(mockSendCronAlertEmail).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith("cron-alert.no-email", expect.any(Error));
  });

  it("never throws, even when sending fails", async () => {
    mockSendCronAlertEmail.mockRejectedValue(new Error("smtp down"));
    await expect(
      alertCronFailure("daily-sync", { failed: 1, total: 1 }),
    ).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith("cron-alert.send", expect.any(Error));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cron-alert.test.ts`
Expected: FAIL (cannot resolve `@/lib/cron-alert`).

- [ ] **Step 3: Write the implementation**

Append to `lib/reporting.ts`:

```ts
export interface CronAlertSummary {
  failed: number;
  total: number;
  /**
   * First error message of the run. Error messages only (the same strings
   * logError already emits); never payloads, balances, or PII.
   */
  firstError?: string;
}

export async function sendCronAlertEmail(
  toEmail: string,
  cronName: string,
  summary: CronAlertSummary,
) {
  const { hostConfigured, transporter } = await createMailTransport();
  const lines = [
    `The ${cronName} cron run at ${new Date().toISOString()} reported failures.`,
    `Failed: ${summary.failed} of ${summary.total}.`,
    summary.firstError ? `First error: ${summary.firstError.slice(0, 200)}` : null,
    "Check the Vercel logs and the dashboard sync status for detail.",
  ].filter((line): line is string => Boolean(line));
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "FundFlow <onboarding@resend.dev>",
    to: toEmail,
    subject: `FundFlow cron failure: ${cronName}`,
    text: lines.join("\n"),
  });
  if (!hostConfigured) logDevelopmentPreview(info);
  return info;
}
```

Create `lib/cron-alert.ts`:

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendCronAlertEmail, type CronAlertSummary } from "@/lib/reporting";
import { logError } from "@/lib/log";

export type { CronAlertSummary } from "@/lib/reporting";

const ALERT_WINDOW_SECONDS = 24 * 3600;

/**
 * Email the admin that a cron run failed, wholly or for some users.
 * Best-effort: never throws into the cron handler. Deduped to one alert per
 * cron name per 24h via the fixed-window limiter; the limiter fails open,
 * which here means at worst an extra email, never a missed cron run.
 */
export async function alertCronFailure(
  cronName: string,
  summary: CronAlertSummary,
): Promise<void> {
  try {
    const allowed = await checkRateLimit(
      `cron-alert:${cronName}`,
      1,
      ALERT_WINDOW_SECONDS,
    );
    if (!allowed) return;

    const service = createServiceClient();
    // Trusted scheduler context: the admin lookup is the only cross-user
    // query, and it selects nothing but the admin's own profile id.
    const { data: admins, error } = await service
      .from("profiles")
      .select("id")
      .eq("role", "admin")
      .limit(1);
    if (error) throw error;
    const adminId = admins?.[0]?.id as string | undefined;
    if (!adminId) {
      logError(
        "cron-alert.no-admin",
        new Error(`no admin profile to alert for ${cronName}`),
      );
      return;
    }

    const { data: userData } = await service.auth.admin.getUserById(adminId);
    const email = userData?.user?.email;
    if (!email) {
      logError(
        "cron-alert.no-email",
        new Error(`admin profile has no email for ${cronName}`),
      );
      return;
    }

    await sendCronAlertEmail(email, cronName, summary);
  } catch (error) {
    logError("cron-alert.send", error);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/cron-alert.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/reporting.ts lib/cron-alert.ts tests/unit/cron-alert.test.ts
git commit -m "feat(observability): cron-failure alert email to the admin"
```

---

### Task 5: Wire alerts into both cron routes

**Files:**
- Modify: `app/api/cron/sync/route.ts` (user loop catch at ~line 96, whole-run catch at ~line 113)
- Modify: `app/api/cron/weekly-report/route.ts` (`WeeklyRunResult` type, user-loop catch, `GET`)
- Test: `tests/unit/cron-sync-route.test.ts`, `tests/unit/cron-weekly-report-route.test.ts` (extend)

**Interfaces:**
- Consumes: `alertCronFailure(cronName, { failed, total, firstError? })` from Task 4.
- Produces: `WeeklyRunResult` gains optional `first_error?: string` (set to the first `safeDeliveryError` value of the run). The JSON shape of both cron responses is otherwise unchanged.

- [ ] **Step 1: Extend the failing tests**

In `tests/unit/cron-sync-route.test.ts`, add next to the other mocks:

```ts
const mockAlertCronFailure = vi.fn();
vi.mock("@/lib/cron-alert", () => ({
  alertCronFailure: (...args: unknown[]) => mockAlertCronFailure(...args),
}));
```

Then add tests (follow the file's existing arrange helpers for the service client `from` chains; reuse how existing tests make `syncAllForUser` resolve or reject):

```ts
it("alerts the admin when a user's sync fails", async () => {
  // arrange: two users, first sync rejects with new Error("ITEM_LOGIN_REQUIRED"),
  // second resolves (copy the arrange pattern of the existing multi-user test)
  // act: GET with the valid secret
  expect(mockAlertCronFailure).toHaveBeenCalledWith("daily-sync", {
    failed: 1,
    total: 2,
    firstError: "ITEM_LOGIN_REQUIRED",
  });
});

it("does not alert when every user syncs cleanly", async () => {
  // arrange: one user, everything resolves
  expect(mockAlertCronFailure).not.toHaveBeenCalled();
});
```

In `tests/unit/cron-weekly-report-route.test.ts`, add the same `vi.mock("@/lib/cron-alert", ...)` block, plus:

```ts
it("alerts the admin when reports failed", async () => {
  // arrange: one due profile whose PDF generation rejects (existing pattern),
  // so runWeeklyReports yields reports_failed: 1, first_error: "pdf_render_failed"
  expect(mockAlertCronFailure).toHaveBeenCalledWith("weekly-report", {
    failed: 1,
    total: 1,
    firstError: "pdf_render_failed",
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/unit/cron-sync-route.test.ts tests/unit/cron-weekly-report-route.test.ts`
Expected: the new tests FAIL (`mockAlertCronFailure` never called); pre-existing tests still pass.

- [ ] **Step 3: Implement the wiring**

`app/api/cron/sync/route.ts`:

Add the import:

```ts
import { alertCronFailure } from "@/lib/cron-alert";
```

Above the user loop, next to `let synced = 0;`, add:

```ts
    const failures: string[] = [];
```

Replace the user-loop catch:

```ts
      } catch (err) {
        logError("cron.sync.user", err);
        failures.push(err instanceof Error ? err.message : String(err));
      }
```

After the housekeeping block, before the final `return NextResponse.json(...)`:

```ts
    if (failures.length > 0) {
      await alertCronFailure("daily-sync", {
        failed: failures.length,
        total: userIds.length,
        firstError: failures[0],
      });
    }
```

Replace the whole-run catch:

```ts
  } catch (error) {
    await alertCronFailure("daily-sync", {
      failed: 1,
      total: 1,
      firstError: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("cron.sync", error);
  }
```

`app/api/cron/weekly-report/route.ts`:

Add the import:

```ts
import { alertCronFailure } from "@/lib/cron-alert";
```

Extend the result type:

```ts
type WeeklyRunResult = {
  users: number;
  due: number;
  reports_sent: number;
  reports_skipped: number;
  reports_failed: number;
  first_error?: string;
};
```

Record the first failure reason everywhere `reports_failed` is incremented, immediately after each increment (three sites: missing report data, PDF failure, user-loop catch):

```ts
        result.first_error ??= "missing_account_email";
```

```ts
        result.first_error ??= "pdf_render_failed";
```

```ts
      result.first_error ??= safeDeliveryError(userError);
```

Replace `GET`'s try body:

```ts
  try {
    const result = await runWeeklyReports();
    if (result.reports_failed > 0) {
      await alertCronFailure("weekly-report", {
        failed: result.reports_failed,
        total: result.due,
        firstError: result.first_error,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await alertCronFailure("weekly-report", {
      failed: 1,
      total: 1,
      firstError: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("cron.weekly-report", error);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cron-sync-route.test.ts tests/unit/cron-weekly-report-route.test.ts tests/unit/cron-alert.test.ts`
Expected: PASS, old and new.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/sync/route.ts app/api/cron/weekly-report/route.ts tests/unit/cron-sync-route.test.ts tests/unit/cron-weekly-report-route.test.ts
git commit -m "feat(observability): wire cron-failure alerts into sync and weekly-report crons"
```

---

### Task 6: Mobile ledger card list

**Files:**
- Create: `components/transactions/MobileLedgerList.tsx`
- Modify: `app/transactions/page.tsx:316-392` (wrap the table for `sm+`, add the card list below `sm`)
- Test: `tests/unit/mobile-ledger-list.test.ts`

**Interfaces:**
- Consumes: existing `TransactionEditor` client component, `Badge`, `formatCurrency`, `titleCase`.
- Produces: `MobileLedgerList({ rows })` server component where each row is:

```ts
export interface LedgerCardRow {
  id: string;
  date: string;
  merchant: string;
  category: string | null;
  accountLabel: string;
  amount: number;
  currency: string;
  pending: boolean;
  note: string | null;
  tags: string[];
  splits: { category: string; amount: number }[];
  categoryOptions: string[];
}
```

- [ ] **Step 1: Write the failing test**

The component is a server component; test it through JSX render-to-string like the existing UI tests (see `tests/unit/dashboard-ui.test.ts` for the pattern used in this repo; mirror its render helper). Create `tests/unit/mobile-ledger-list.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

vi.mock("@/components/transactions/TransactionEditor", () => ({
  default: () => React.createElement("span", { "data-testid": "editor" }),
}));

import MobileLedgerList from "@/components/transactions/MobileLedgerList";

const baseRow = {
  id: "t1",
  date: "2026-07-15",
  merchant: "Blue Bottle",
  category: "FOOD_AND_DRINK",
  accountLabel: "Checking ••1234",
  amount: 6.5,
  currency: "USD",
  pending: false,
  note: null,
  tags: [] as string[],
  splits: [] as { category: string; amount: number }[],
  categoryOptions: ["FOOD_AND_DRINK"],
};

describe("MobileLedgerList", () => {
  it("renders merchant, formatted amount, category, and account", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(html).toContain("Blue Bottle");
    expect(html).toContain("-$6.50");
    expect(html).toContain("Food And Drink");
    expect(html).toContain("Checking ••1234");
  });

  it("marks inflows with a plus sign", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, {
        rows: [{ ...baseRow, amount: -100 }],
      }),
    );
    expect(html).toContain("+$100.00");
  });

  it("shows the pending badge only when pending", () => {
    const pendingHtml = renderToStaticMarkup(
      React.createElement(MobileLedgerList, {
        rows: [{ ...baseRow, pending: true }],
      }),
    );
    expect(pendingHtml).toContain("pending");
    const settledHtml = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(settledHtml).not.toContain("pending");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mobile-ledger-list.test.ts`
Expected: FAIL (cannot resolve the component).

- [ ] **Step 3: Write the component**

Create `components/transactions/MobileLedgerList.tsx`:

```tsx
import Badge from "@/components/ui/Badge";
import TransactionEditor from "@/components/transactions/TransactionEditor";
import { formatCurrency, titleCase } from "@/lib/format";

export interface LedgerCardRow {
  id: string;
  date: string;
  merchant: string;
  category: string | null;
  accountLabel: string;
  amount: number;
  currency: string;
  pending: boolean;
  note: string | null;
  tags: string[];
  splits: { category: string; amount: number }[];
  categoryOptions: string[];
}

/**
 * Phone-width twin of the ledger table: one stacked card per transaction.
 * Rendered below the `sm` breakpoint; the table remains the sm+ rendering.
 */
export default function MobileLedgerList({ rows }: { rows: LedgerCardRow[] }) {
  return (
    <ul className="divide-y divide-panel-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{row.merchant}</span>
              {row.pending && <Badge tone="warning">pending</Badge>}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {row.date} · {titleCase(row.category) || "Uncategorized"} ·{" "}
              {row.accountLabel}
            </p>
            {(row.note || row.tags.length > 0 || row.splits.length > 0) && (
              <p className="mt-1 flex flex-wrap items-center gap-1.5">
                {row.splits.length > 0 && (
                  <Badge tone="accent">split ×{row.splits.length}</Badge>
                )}
                {row.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
                {row.note && <span className="text-xs text-muted">{row.note}</span>}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className="whitespace-nowrap font-semibold tabular-nums"
              style={
                row.amount < 0
                  ? { color: "var(--success)" }
                  : { color: "var(--danger)" }
              }
            >
              {row.amount < 0 ? "+" : "-"}
              {formatCurrency(Math.abs(row.amount), row.currency)}
            </span>
            <TransactionEditor
              transaction={{
                id: row.id,
                merchant: row.merchant,
                amount: row.amount,
                currency: row.currency,
              }}
              note={row.note}
              tags={row.tags}
              splits={row.splits}
              categories={row.categoryOptions}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Integrate into the transactions page**

In `app/transactions/page.tsx`, import the component:

```ts
import MobileLedgerList, { type LedgerCardRow } from "@/components/transactions/MobileLedgerList";
```

After the `categoryOptions` computation, build the card rows:

```ts
  const cardRows: LedgerCardRow[] = rows.map((t) => {
    const ann = annById.get(t.id as string);
    return {
      id: t.id as string,
      date: t.date as string,
      merchant: (t.merchant_name ?? t.name ?? "Unknown") as string,
      category: t.pfc_primary as string | null,
      accountLabel: accountName.get(t.account_id) ?? "-",
      amount: t.amount as number,
      currency: (t.iso_currency_code ?? "USD") as string,
      pending: Boolean(t.pending),
      note: ann?.note ?? null,
      tags: ann?.tags ?? [],
      splits: splitsById.get(t.id as string) ?? [],
      categoryOptions,
    };
  });
```

In the JSX, inside the `<Panel padding="none" ...>` that holds the table:
- change the table wrapper `<div className="overflow-x-auto">` to `<div className="hidden overflow-x-auto sm:block">`;
- immediately before that div, add:

```tsx
            <div className="sm:hidden">
              <MobileLedgerList rows={cardRows} />
            </div>
```

- [ ] **Step 5: Run tests and gates**

Run: `npx vitest run tests/unit/mobile-ledger-list.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add components/transactions/MobileLedgerList.tsx app/transactions/page.tsx tests/unit/mobile-ledger-list.test.ts
git commit -m "feat(mobile): stacked card ledger below the sm breakpoint"
```

---

### Task 7: Touch targets and scroll-strip polish

**Files:**
- Modify: `components/shell/AppSidebar.tsx:96` (mobile strip)
- Modify: `components/dashboard/MonthChips.tsx:49` (chip hit area)
- Modify: `components/shell/AppSidebar.tsx:64` (compact NavLink hit area)

**Interfaces:** none new; class-only changes. 44px = Tailwind `min-h-11`.

- [ ] **Step 1: Enlarge tap targets**

`components/dashboard/MonthChips.tsx`: in the `Link` `cn(...)` call, change the first string to add a minimum hit area while keeping the visual size (padding grows on touch-first widths, returns to compact at `sm`):

```ts
"flex min-h-11 shrink-0 items-center rounded-field border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 sm:min-h-0",
```

`components/shell/AppSidebar.tsx`, `NavLink` compact branch: change

```ts
compact ? "shrink-0 px-3 py-2" : "w-full px-3 py-2.5",
```

to

```ts
compact ? "min-h-11 shrink-0 px-3 py-2" : "w-full px-3 py-2.5",
```

- [ ] **Step 2: Scroll-strip edge fade**

`components/shell/AppSidebar.tsx`, the mobile `<nav>` (line ~96): append the mask utility so overflowing items fade at the right edge, signaling scrollability:

```ts
className="lg:hidden -mx-4 flex gap-2 overflow-x-auto border-b border-panel-border px-4 py-3 scrollbar-none sm:-mx-6 sm:px-6 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]"
```

- [ ] **Step 3: Verify gates**

Run: `npx tsc --noEmit && npm run lint && npm run test:unit`
Expected: green (class-only changes; snapshot-free tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add components/shell/AppSidebar.tsx components/dashboard/MonthChips.tsx
git commit -m "feat(mobile): 44px touch targets and scroll-strip edge fade"
```

---

### Task 8: Screenshot QA at phone widths and fixes

**Files:**
- Modify: whatever the screenshots implicate (expect small class changes in `components/dashboard/DashboardToolbar.tsx`, `components/dashboard/CardCarousel.tsx`, `app/settings/*`, chart containers under `components/charts/`)

**Interfaces:** none; this is a verification loop with fix commits.

- [ ] **Step 1: Start the app and sign in**

Run: `npm run dev` (background). Open the app with the browser tooling (Playwright or chrome-devtools MCP) at `http://localhost:3000`.

Sign-in: ask the user for dev credentials if a signed-in run with real data is possible; otherwise sign up a fresh throwaway user via `/signup` (Supabase email confirmation may need the emailed link; if `.env.local` auth blocks this, fall back to asking the user). A fresh user exercises layout with empty states, which still covers the shell, settings, notifications, goals, and login pages.

- [ ] **Step 2: Screenshot sweep**

For each of 375px and 414px viewport widths, screenshot these routes and record failures:
`/login`, `/dashboard?view=monitor`, `/dashboard?view=plan`, `/dashboard?view=wealth`, `/transactions` (with and without a `category` filter), `/goals`, `/notifications`, `/settings`.

Acceptance per page:
1. No horizontal body scroll: run in the page context
   `document.documentElement.scrollWidth <= window.innerWidth` and expect `true`.
2. Every wide element (chart, table, toolbar, carousel) scrolls inside its own container.
3. Interactive controls do not overlap and are comfortably tappable.
4. Text does not overflow or truncate meaninglessly.

- [ ] **Step 3: Fix what the screenshots show**

Apply minimal Tailwind class fixes per finding (wrap toolbars with `flex-wrap`, add `overflow-x-auto` containers, adjust paddings). One commit per coherent batch:

```bash
git add -A && git commit -m "fix(mobile): <specific finding> at phone widths"
```

- [ ] **Step 4: Re-shoot until clean**

Repeat Steps 2-3 until every page passes all four acceptance checks at both widths. Save the final screenshot set to the scratchpad and summarize which pages needed changes.

---

### Task 9: Docs, final gates, and handoff

**Files:**
- Modify: `docs/TODO.md` (mark mobile polish, cron alert, and session revocation items done)
- Modify: `docs/HANDOFF.md` (new session entry)

- [ ] **Step 1: Update docs**

`docs/TODO.md`: strike through (with `~~...~~ Done (2026-07-16)` notes, matching the file's existing style):
- the "Mobile support" bullet under Requested enhancements;
- the "*Still optional:* an alert email when a whole cron run fails" clause in item 4;
- the deferred session-revocation note if present.

`docs/HANDOFF.md`: add a session section at the top titled "Latest session (2026-07-16, branch `feat/remaining-must-haves`)" summarizing the three features, files touched, and the QA method, following the file's existing format. Demote the previous "Latest session" heading to "Previous session".

- [ ] **Step 2: Final gates**

Run: `npm run build && npm run lint && npm run test:unit`
Expected: all green. Record the test count.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/HANDOFF.md
git commit -m "docs: record revocation enforcement, cron alerts, and mobile polish"
```

- [ ] **Step 4: Verify the changed flows end-to-end**

Use the repo's verification approach (the `verify` skill if available): revoked-session redirect observed in the browser (Task 3 Step 3, if it was deferred), one forced cron-alert path exercised in dev (temporarily point `alertCronFailure` at a failing sync in a scratch script or trigger `/api/cron/sync` locally with a broken item), and the mobile screenshot set from Task 8. Then offer the user merge/PR options per the finishing-a-development-branch skill.
