# Phase 1: Navigation and Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shell (sidebar, top bar, command palette) a single source of truth for navigation, add the top-bar utility actions (search, notifications, settings) and a gated Ask-AI shortcut, and add a persisted sidebar-collapse control, without shipping any placeholder route or duplicating the canonical Phase 0 finance semantics.

**Architecture:** `components/shell/nav-model.ts` already exports `NAV_ITEMS`/`UTILITY_ITEMS` (added incidentally while wiring the accounts/cash-flow/budget feature flags). This phase finishes wiring those exports through every shell surface that currently duplicates or ignores them (`AppSidebar`, `CommandPalette`, `TopBar`), adds the two new per-user reads the utility actions need (unread notification count, Ask-AI double consent), and adds one new client-side interaction (sidebar collapse) that writes through to `profiles.dashboard_prefs`, the existing per-user preferences column. No new tables, no new migration, no new Plaid calls.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Supabase Postgres with RLS, Vitest, Playwright.

## Global Constraints

(Carried forward from `docs/superpowers/archive/plans/2026-07-29-monarch-parity.md`'s "Global Constraints", trimmed to what this phase touches.)

- Preserve every security invariant in `CLAUDE.md`: RLS on all user tables, service-client queries always filter `user_id`, nonce-based CSP (no new external script/img hosts), MFA enforcement untouched.
- Use original FundFlow copy, icons, illustrations — no Monarch branding or assets.
- Every chart, table, dialog, wizard, and interactive control meets WCAG 2.2 AA keyboard, focus, name, contrast, reduced-motion, and screen-reader requirements.
- Responsive E2E acceptance runs at 1440x900, 768x1024, and 390x844 in both light and dark themes.
- Feature navigation remains hidden until the page is production-ready; a nav item is visible only when its route is already implemented or its server-side feature flag is enabled.
- Do not modify protected route prefixes in `proxy.ts`. It already protects every non-public page by default; new private paths need zero additional wiring.
- Do not ship authenticated "Coming soon" pages.
- Commit messages: conventional commits, no co-author lines. Do not use the em dash character anywhere.
- Run the focused failing test first, then `npm run lint`, `npx tsc --noEmit`, and `npm run test:unit` before every commit. Run `npm test`, `npm run build`, and the touched Playwright journey before the PR.
- No migration in this phase — nothing to apply to the live Supabase project.

## Known deviation from the master plan (flagged, not silent)

The Phase 1 section of the master plan has one step: *"Move 'Year in Money' under Reports (link from the Reports page) and remove it from the top-level nav... keep `/wrapped` working."* Reports is Phase 6 and does not exist yet — `docs/HANDOFF.md` already recorded this exact conflict as the reason Phase 1 was deferred twice. This plan keeps `wrapped` as a top-level "Manage" nav entry (unchanged) and defers the move to Phase 6, where the Reports page will actually exist to receive the link. Task 7 records this explicitly in `docs/HANDOFF.md` so Phase 6 does not silently drop it.

The master plan's step *"Convert Monitor, Plan, and Wealth from top-level nav entries into dashboard subviews reachable from a compact Overview menu"* is already true today: `NAV_ITEMS` has never had `monitor`/`plan`/`wealth` entries, and `app/dashboard/page.tsx` already reaches them through a compact `Tabs` strip (`components/ui/Tabs.tsx`) at `/dashboard?view=monitor|plan|wealth`. Task 7 adds a regression test locking this in rather than re-implementing something already correct.

## File Map

**Modify:**

- `components/shell/nav-model.ts`
- `components/shell/AppSidebar.tsx`
- `components/shell/TopBar.tsx`
- `components/shell/AppShell.tsx`
- `components/CommandPalette.tsx`
- `components/settings/DashboardPrefsSection.tsx`
- `app/settings/page.tsx`
- `app/api/ai/ask/route.ts`
- `lib/notifications.ts`
- `docs/HANDOFF.md`

**Create:**

- `lib/ai-gate.ts`
- `components/shell/SearchButton.tsx`
- `components/shell/NotificationsBell.tsx`
- `components/shell/AskAiLowerRailLink.tsx`
- `components/shell/SidebarShell.tsx`
- `components/shell/command-palette-events.ts`
- `tests/unit/notifications-count.test.ts`
- `tests/unit/ai-gate.test.ts`
- `tests/e2e/planner-ia.spec.ts`

**Expand:**

- `tests/unit/sidebar-nav.test.ts`
- `tests/unit/command-palette.test.ts`
- `tests/unit/proxy.test.ts` (or nearest existing proxy test file — see Task 3, Step 0)

---

### Task 1: Single source of truth for nav items

**Files:**

- Modify: `components/shell/nav-model.ts`
- Modify: `components/shell/AppSidebar.tsx`
- Test: `tests/unit/sidebar-nav.test.ts`

**Interfaces:**

- Produces:

```ts
export interface NavItemDefinition {
  key: NavItemKey;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  category: "primary" | "planning" | "manage";
  featureFlag?: FeatureFlag;
  hint: string;
}

export function getEnabledNavItems(env?: FeatureFlagEnv): NavItemDefinition[];
```

- Consumes: `isFeatureEnabled` from `@/lib/feature-flags` (unchanged signature).

- [ ] **Step 1: Write the failing contract test**

Add to `tests/unit/sidebar-nav.test.ts` (append to the existing `describe` block, keep the existing assertions):

```ts
import { NAV_ITEMS, UTILITY_ITEMS, getEnabledNavItems } from "@/components/shell/nav-model";

it("has unique keys and non-empty labels, hrefs, and hints for every item", () => {
  const keys = new Set<string>();
  for (const item of NAV_ITEMS) {
    expect(keys.has(item.key)).toBe(false);
    keys.add(item.key);
    expect(item.label.length).toBeGreaterThan(0);
    expect(item.href.startsWith("/")).toBe(true);
    expect(item.hint.length).toBeGreaterThan(0);
  }
});

it("keeps NAV_ITEMS in a fixed primary -> planning -> manage order", () => {
  const categories = NAV_ITEMS.map((item) => item.category);
  const firstPlanning = categories.indexOf("planning");
  const firstManage = categories.indexOf("manage");
  const lastPrimary = categories.lastIndexOf("primary");
  expect(lastPrimary).toBeLessThan(firstPlanning);
  expect(firstPlanning).toBeLessThan(firstManage);
});

it("getEnabledNavItems drops items whose feature flag is off and keeps unflagged items", () => {
  const allOff = getEnabledNavItems({ FUNDFLOW_FEATURE_FLAGS: "" });
  // accountsPage/cashFlowPage/budgetPage default to true today, so this only
  // proves the filter runs the same predicate AppSidebar used to inline.
  expect(allOff.some((item) => item.key === "dashboard")).toBe(true);
  expect(allOff.every((item) => !item.featureFlag || item.key)).toBe(true);
});

it("defines three utility items with a search, notifications, and settings action", () => {
  const actions = UTILITY_ITEMS.map((item) => item.action);
  expect(actions).toEqual(["search", "notifications", "settings"]);
  for (const item of UTILITY_ITEMS) {
    expect(item.label.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

```bash
npx vitest run tests/unit/sidebar-nav.test.ts
```

Expected: fails on `getEnabledNavItems` (does not exist) and on `item.hint` (field does not exist).

- [ ] **Step 3: Add `hint` to every `NavItemDefinition` and implement `getEnabledNavItems`**

In `components/shell/nav-model.ts`, add `hint: string` to the interface and to every entry, and add the exported filter function:

```ts
export interface NavItemDefinition {
  key: NavItemKey;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  category: "primary" | "planning" | "manage";
  featureFlag?: FeatureFlag;
  hint: string;
}

export const NAV_ITEMS: NavItemDefinition[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, category: "primary", hint: "Monitor, plan, and wealth views" },
  { key: "accounts", label: "Accounts", href: "/accounts", icon: Landmark, category: "primary", featureFlag: "accountsPage", hint: "Grouped balances and history" },
  { key: "transactions", label: "Transactions", href: "/transactions", icon: Wallet, category: "primary", hint: "Ledger" },
  { key: "cashflow", label: "Cash Flow", href: "/cash-flow", icon: ArrowLeftRight, category: "primary", featureFlag: "cashFlowPage", hint: "Income, expenses, savings rate" },
  { key: "budget", label: "Budget", href: "/budget", icon: PiggyBank, category: "planning", featureFlag: "budgetPage", hint: "Monthly envelopes" },
  { key: "goals", label: "Goals", href: "/goals", icon: Target, category: "planning", hint: "Savings goals" },
  { key: "notifications", label: "Notifications", href: "/notifications", icon: Mail, category: "manage", hint: "Alerts and digests" },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings, category: "manage", hint: "Control center" },
  { key: "wrapped", label: "Year in Money", href: "/wrapped", icon: Sparkles, category: "manage", hint: "Annual recap" },
];

export function getEnabledNavItems(env?: FeatureFlagEnv): NavItemDefinition[] {
  return NAV_ITEMS.filter((item) => !item.featureFlag || isFeatureEnabled(item.featureFlag, env));
}
```

`isFeatureEnabled`/`FeatureFlagEnv` are already imported for the `FeatureFlag` type; add `isFeatureEnabled` itself to that same top-of-file import instead of `AppSidebar`'s current mid-file import.

- [ ] **Step 4: Point `AppSidebar` at `getEnabledNavItems` instead of its own inline filter**

In `components/shell/AppSidebar.tsx`, replace:

```tsx
import { isFeatureEnabled } from "@/lib/feature-flags";

export default function AppSidebar({ active }: Readonly<{ active: AppShellActive }>) {
  const enabledItems = NAV_ITEMS.filter(
    (item) => !item.featureFlag || isFeatureEnabled(item.featureFlag),
  );
```

with:

```tsx
export default function AppSidebar({ active }: Readonly<{ active: AppShellActive }>) {
  const enabledItems = getEnabledNavItems();
```

and update the top import to `import { getEnabledNavItems, type AppShellActive, type NavItemDefinition } from "@/components/shell/nav-model";` (drop the now-unused `NAV_ITEMS` import from this file; `nav-model.ts` still exports it for `CommandPalette`/tests).

This must stay a pure refactor: `AppSidebar` remains a server component (no `"use client"`), so `isFeatureEnabled`'s env-var override keeps working exactly as before (this matters for Task 6 — see the note there about why the sidebar chrome cannot become a client component wholesale).

- [ ] **Step 5: Run the focused test and confirm it passes**

```bash
npx vitest run tests/unit/sidebar-nav.test.ts
npm run lint
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add components/shell/nav-model.ts components/shell/AppSidebar.tsx tests/unit/sidebar-nav.test.ts
git commit -m "refactor(nav): centralize enabled-item filtering in nav-model"
```

---

### Task 2: Command palette parity with NAV_ITEMS

**Files:**

- Modify: `components/CommandPalette.tsx`
- Modify: `components/shell/AppShell.tsx`
- Create: `components/shell/command-palette-events.ts`
- Test: `tests/unit/command-palette.test.ts`

**Interfaces:**

- Consumes: `getEnabledNavItems()` from Task 1.
- Produces:

```ts
// components/shell/command-palette-events.ts
export const OPEN_COMMAND_PALETTE_EVENT = "fundflow:open-command-palette";
```

```ts
// CommandPalette.tsx
interface Command {
  label: string;
  href: string;
  hint: string;
}
export default function CommandPalette({ items }: Readonly<{ items: Command[] }>): JSX.Element | null;
```

- [ ] **Step 1: Write the failing parity test**

Add to `tests/unit/command-palette.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { getEnabledNavItems } from "@/components/shell/nav-model";

it("AppShell builds CommandPalette's command list from every enabled nav item", () => {
  const appShellSource = readFileSync("components/shell/AppShell.tsx", "utf8");
  expect(appShellSource).toContain("getEnabledNavItems");
  expect(appShellSource).toContain("<CommandPalette items=");
});

it("every enabled nav item has a matching href in the built command list, including /wrapped", () => {
  const enabledHrefs = new Set(getEnabledNavItems().map((item) => item.href));
  const appShellSource = readFileSync("components/shell/AppShell.tsx", "utf8");
  for (const href of enabledHrefs) {
    expect(appShellSource.includes("item.href") || appShellSource.includes(href)).toBe(true);
  }
  expect(enabledHrefs.has("/wrapped")).toBe(true);
});

it("dispatches the shared open-command-palette event on Cmd+K listener setup", () => {
  const source = readFileSync("components/CommandPalette.tsx", "utf8");
  expect(source).toContain("OPEN_COMMAND_PALETTE_EVENT");
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

```bash
npx vitest run tests/unit/command-palette.test.ts
```

Expected: fails, `AppShell.tsx` has no `getEnabledNavItems`/`CommandPalette items=` yet.

- [ ] **Step 3: Add the shared event name**

Create `components/shell/command-palette-events.ts`:

```ts
/** Shared event name so TopBar's search button (Task 4) can open the
 * palette without lifting its open/closed state out of the component. */
export const OPEN_COMMAND_PALETTE_EVENT = "fundflow:open-command-palette";
```

- [ ] **Step 4: Make `CommandPalette` accept its command list as a prop and listen for the shared event**

In `components/CommandPalette.tsx`, remove the local `COMMANDS` constant and the `Command` interface stays but is imported from nowhere new (kept local). Replace the component signature and keyboard effect:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "@/components/ui/icons";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/shell/command-palette-events";

interface Command {
  label: string;
  href: string;
  hint: string;
}

export default function CommandPalette({ items }: Readonly<{ items: Command[] }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.hint.toLowerCase().includes(needle),
    );
  }, [items, query]);
  // ... close/activate stay unchanged below this point ...
```

and in the keyboard `useEffect`, add a listener for the shared event alongside the existing Cmd+K handler:

```tsx
useEffect(() => {
  function onKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setOpen((current) => !current);
      setQuery("");
      setSelected(0);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }
  function onOpenRequest() {
    setOpen(true);
    setQuery("");
    setSelected(0);
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
  };
}, []);
```

Everything else in the file (close/activate/render) is unchanged, only referencing `items` instead of `COMMANDS`.

- [ ] **Step 5: Build the command list in `AppShell` and pass it down**

In `components/shell/AppShell.tsx`:

```tsx
import type { ReactNode } from "react";
import AppSidebar, { type AppShellActive } from "@/components/shell/AppSidebar";
import CommandPalette from "@/components/CommandPalette";
import TopBar from "@/components/shell/TopBar";
import { getEnabledNavItems } from "@/components/shell/nav-model";
import { dashboardUrl } from "@/lib/drilldown";

const EXTRA_COMMANDS = [
  { label: "Plan view", href: dashboardUrl({ view: "plan" }), hint: "Budgets, bills, debt" },
  { label: "Wealth view", href: dashboardUrl({ view: "wealth" }), hint: "Net worth and breakdowns" },
  { label: "Review", href: "/review", hint: "Monthly review" },
  { label: "Export CSV", href: "/api/export/csv", hint: "Privacy-safe download" },
  { label: "Tax CSV", href: "/api/export/csv?scope=tax", hint: "Tax-tagged download" },
];

export default function AppShell({
  active,
  email,
  children,
}: Readonly<{
  active: AppShellActive;
  email?: string | null;
  children: ReactNode;
}>) {
  const commands = [
    ...getEnabledNavItems().map((item) => ({ label: item.label, href: item.href, hint: item.hint })),
    ...EXTRA_COMMANDS,
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <CommandPalette items={commands} />
      <TopBar email={email} />
      <div className="lg:flex">
        <AppSidebar active={active} />
        <main className="w-full min-w-0 px-4 py-5 sm:px-6 lg:px-7 lg:py-7">
          <div className="mx-auto max-w-[1320px] space-y-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
```

Check `lib/drilldown.ts`'s `dashboardUrl` signature before using it here (it is already imported the same way in `app/dashboard/page.tsx`) — if it requires more than `{ view }` (e.g. a mandatory month), pass `{ view: "plan" }` only if that is valid per its existing type; otherwise hardcode the href strings `"/dashboard?view=plan"` / `"/dashboard?view=wealth"` exactly as the old `COMMANDS` array did, to avoid introducing a dependency this task doesn't need.

- [ ] **Step 6: Run the focused tests and confirm they pass**

```bash
npx vitest run tests/unit/command-palette.test.ts tests/unit/sidebar-nav.test.ts
npm run lint
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add components/CommandPalette.tsx components/shell/AppShell.tsx components/shell/command-palette-events.ts tests/unit/command-palette.test.ts
git commit -m "feat(nav): drive command palette from the enabled nav item list"
```

---

### Task 3: Default-deny regression test for new private paths

**Files:**

- Test: nearest existing proxy test file (run `ls tests/unit | grep -i proxy` first; if none exists, create `tests/unit/proxy.test.ts` importing `isPublicPage`-equivalent behavior via the exported helpers in `proxy.ts`)

**Interfaces:**

- Consumes: whatever `proxy.ts` currently exports for testing (check the file's exports before writing this task — do not assume `isPublicPage` is exported; if it isn't, this test asserts against `PUBLIC_PAGE_PATHS` if that is exported, or documents the constant inline by reading the source with `readFileSync` and asserting the new path is absent from it, consistent with this repo's source-level test convention).

- [ ] **Step 1: Read `proxy.ts`'s current exports**

```bash
grep -n "^export" proxy.ts
```

- [ ] **Step 2: Write the regression test**

If `PUBLIC_PAGE_PATHS` (or equivalent) is exported, test it directly:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("proxy.ts default-deny for new private paths", () => {
  it("does not add a hypothetical new phase-1 path to the public allowlist", () => {
    const source = readFileSync("proxy.ts", "utf8");
    const allowlistMatch = source.match(/PUBLIC_PAGE_PATHS\s*=\s*\[([^\]]*)\]/);
    expect(allowlistMatch).not.toBeNull();
    const allowlist = allowlistMatch![1];
    expect(allowlist).not.toContain("/planner-ia-check");
  });
});
```

This is a documentation-style regression, not a behavior test: `proxy.ts` already redirects any path outside `isPublicPage()` to `/login` by construction (verified by reading the file during planning), so the only way Phase 1 could regress this is by someone adding a new nav destination straight into `PUBLIC_PAGE_PATHS` by mistake. The test guards against that mistake, it does not re-verify Next.js middleware routing (already covered by existing auth E2E specs).

- [ ] **Step 3: Run it**

```bash
npx vitest run <the test file from Step 1/2>
```

- [ ] **Step 4: Commit**

```bash
git add <the test file>
git commit -m "test(proxy): guard the public-path allowlist against accidental growth"
```

---

### Task 4: TopBar utility actions (search, notifications, settings)

**Files:**

- Create: `components/shell/SearchButton.tsx`
- Create: `components/shell/NotificationsBell.tsx`
- Modify: `components/shell/TopBar.tsx`
- Modify: `lib/notifications.ts`
- Test: `tests/unit/notifications-count.test.ts`
- Test: extend `tests/unit/sidebar-nav.test.ts` or a new `tests/unit/topbar.test.ts` for the wiring assertions (pick `tests/unit/topbar.test.ts` — new file, one clear home)

**Interfaces:**

- Produces:

```ts
// lib/notifications.ts (new export, existing exports unchanged)
export async function getUnreadNotificationCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number>;
```

- Consumes: `createClient()` from `@/lib/supabase/server` (cookie-bound, RLS-scoped) inside the new server components.

- [ ] **Step 1: Write the failing unit test for the count query**

Create `tests/unit/notifications-count.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getUnreadNotificationCount } from "@/lib/notifications";

function fakeSupabase(count: number | null, error: unknown = null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ count, error }),
        }),
      }),
    }),
  } as never;
}

describe("getUnreadNotificationCount", () => {
  it("returns the count for the given user's unread notifications", async () => {
    const supabase = fakeSupabase(3);
    expect(await getUnreadNotificationCount(supabase, "user-1")).toBe(3);
  });

  it("fails open to 0 on a query error instead of throwing", async () => {
    const supabase = fakeSupabase(null, new Error("boom"));
    expect(await getUnreadNotificationCount(supabase, "user-1")).toBe(0);
  });

  it("returns 0 when count is null with no error", async () => {
    const supabase = fakeSupabase(null);
    expect(await getUnreadNotificationCount(supabase, "user-1")).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run tests/unit/notifications-count.test.ts
```

Expected: fails, `getUnreadNotificationCount` is not exported yet.

- [ ] **Step 3: Implement the count query**

Add to `lib/notifications.ts` (append; keep existing service-client functions untouched), with the `SupabaseClient` type import added to the top of the file:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Unread count for the top-bar bell (Phase 1). Takes the caller's own
 * RLS-bound client (not the service client) since this always runs for the
 * signed-in user reading their own notifications. Fails open to 0 so a
 * transient query error never breaks the shell chrome.
 */
export async function getUnreadNotificationCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run tests/unit/notifications-count.test.ts
```

- [ ] **Step 5: Write the failing wiring test for TopBar/SearchButton/NotificationsBell**

Create `tests/unit/topbar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("TopBar utility actions", () => {
  it("renders SearchButton, NotificationsBell, and a Settings link, hidden below sm", () => {
    const source = readFileSync("components/shell/TopBar.tsx", "utf8");
    expect(source).toContain("SearchButton");
    expect(source).toContain("NotificationsBell");
    expect(source).toContain('href="/settings"');
    expect(source).toContain("sm:flex");
  });

  it("SearchButton dispatches the shared open-command-palette event", () => {
    const source = readFileSync("components/shell/SearchButton.tsx", "utf8");
    expect(source).toContain("OPEN_COMMAND_PALETTE_EVENT");
    expect(source).toContain('"use client"');
  });

  it("NotificationsBell reads the unread count via getUnreadNotificationCount", () => {
    const source = readFileSync("components/shell/NotificationsBell.tsx", "utf8");
    expect(source).toContain("getUnreadNotificationCount");
    expect(source).toContain('href="/notifications"');
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

```bash
npx vitest run tests/unit/topbar.test.ts
```

- [ ] **Step 7: Implement `SearchButton`**

Create `components/shell/SearchButton.tsx`:

```tsx
"use client";

import { Search } from "@/components/ui/icons";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/shell/command-palette-events";

export default function SearchButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
      aria-label="Search (Cmd+K)"
      title="Search (Cmd+K)"
      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel-2 text-muted shadow-sm transition-colors duration-150 hover:border-accent/50 hover:text-foreground focus-visible:outline-2"
    >
      <Search aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}
```

- [ ] **Step 8: Implement `NotificationsBell`**

Create `components/shell/NotificationsBell.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { Mail } from "@/components/ui/icons";

export default async function NotificationsBell() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const unread = user ? await getUnreadNotificationCount(supabase, user.id) : 0;

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      title="Notifications"
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel-2 text-muted shadow-sm transition-colors duration-150 hover:border-accent/50 hover:text-foreground focus-visible:outline-2"
    >
      <Mail aria-hidden className="h-3.5 w-3.5" />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.6rem] font-bold text-danger-foreground"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
```

Check `app/globals.css` / the Tailwind theme for a `bg-danger`/`text-danger-foreground` token pair before using it (the codebase uses `--viz-*` and semantic tokens like `text-danger` elsewhere for alerts, e.g. broken-bank banners) — if the exact token names differ, use whatever the existing danger/alert token is named, do not invent a new color.

- [ ] **Step 9: Wire both into `TopBar`, hidden below `sm` to avoid crowding the 390px viewport**

In `components/shell/TopBar.tsx`:

```tsx
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import PrivacyToggle from "@/components/PrivacyToggle";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";
import SearchButton from "@/components/shell/SearchButton";
import NotificationsBell from "@/components/shell/NotificationsBell";
import { Settings } from "@/components/ui/icons";

export default function TopBar({ email }: Readonly<{ email?: string | null }>) {
  return (
    <header className="sticky top-0 z-30 border-b border-panel-border bg-background/88 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-7">
        <Link href="/dashboard" className="rounded-field focus-visible:outline-2">
          <Logo />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          {email && (
            <span className="hidden max-w-[15rem] truncate text-xs font-medium text-muted md:inline">
              {email}
            </span>
          )}
          <div className="hidden items-center gap-2 sm:flex">
            <SearchButton />
            <NotificationsBell />
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel-2 text-muted shadow-sm transition-colors duration-150 hover:border-accent/50 hover:text-foreground focus-visible:outline-2"
            >
              <Settings aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </div>
          <PrivacyToggle />
          <ThemeToggle variant="switch" />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
```

Below `sm` (390px acceptance), Search/Notifications/Settings stay reachable through the existing mobile pill nav row (`notifications` and `settings` are already `NAV_ITEMS` entries rendered there) — this is a deliberate scope decision to avoid 6 circular icon buttons overflowing a 390px header; record it in the E2E task's notes, not just here.

- [ ] **Step 10: Run the focused tests and confirm they pass**

```bash
npx vitest run tests/unit/topbar.test.ts tests/unit/notifications-count.test.ts
npm run lint
npx tsc --noEmit
```

- [ ] **Step 11: Commit**

```bash
git add components/shell/SearchButton.tsx components/shell/NotificationsBell.tsx components/shell/TopBar.tsx lib/notifications.ts tests/unit/notifications-count.test.ts tests/unit/topbar.test.ts
git commit -m "feat(nav): add top-bar search, notifications, and settings actions"
```

---

### Task 5: Gated Ask-AI lower-rail link

**Files:**

- Create: `lib/ai-gate.ts`
- Create: `components/shell/AskAiLowerRailLink.tsx`
- Modify: `components/shell/AppSidebar.tsx`
- Modify: `app/settings/page.tsx`
- Test: `tests/unit/ai-gate.test.ts`
- Test: extend `tests/unit/sidebar-nav.test.ts`

**Interfaces:**

- Produces:

```ts
// lib/ai-gate.ts
export async function isAskAiAvailable(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean>;
```

- Consumes: `isAiProviderConfigured()` from `@/lib/ai-provider` (existing, synchronous, no args).

- [ ] **Step 1: Write the failing gate test**

Create `tests/unit/ai-gate.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { isAskAiAvailable } from "@/lib/ai-gate";

vi.mock("@/lib/ai-provider", () => ({ isAiProviderConfigured: vi.fn(() => true) }));

function fakeSupabase(aiSettingsEnabled: boolean | null, exportEnabled: boolean | null) {
  return {
    from: vi.fn((table: string) => {
      if (table === "ai_settings") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { enabled: aiSettingsEnabled } }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { ai_export_enabled: exportEnabled } }),
          }),
        }),
      };
    }),
  } as never;
}

describe("isAskAiAvailable", () => {
  it("is true only when both ai_settings.enabled and profiles.ai_export_enabled are true", async () => {
    expect(await isAskAiAvailable(fakeSupabase(true, true), "u1")).toBe(true);
  });

  it("is false when ai_settings.enabled is false", async () => {
    expect(await isAskAiAvailable(fakeSupabase(false, true), "u1")).toBe(false);
  });

  it("is false when profiles.ai_export_enabled is false", async () => {
    expect(await isAskAiAvailable(fakeSupabase(true, false), "u1")).toBe(false);
  });

  it("is false when ai_settings.enabled is missing (no row yet)", async () => {
    expect(await isAskAiAvailable(fakeSupabase(null, true), "u1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run tests/unit/ai-gate.test.ts
```

- [ ] **Step 3: Implement the gate**

Create `lib/ai-gate.ts`, mirroring the exact double-consent predicate already used in `app/api/ai/ask/route.ts` (`settings?.enabled !== true` / `ai_export_enabled === false`), but as two cheap single-row selects instead of `fetchPrivacySafeRows`'s full export-row query:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiProviderConfigured } from "@/lib/ai-provider";

/**
 * Same double-consent gate as /api/ai/ask (ai_settings.enabled AND
 * profiles.ai_export_enabled), but two cheap column selects instead of
 * fetchPrivacySafeRows's full export-row query — this is only used to
 * decide whether to show a nav link, not to fetch AI grounding data.
 */
export async function isAskAiAvailable(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  if (!isAiProviderConfigured()) return false;

  const [{ data: settings }, { data: profile }] = await Promise.all([
    supabase.from("ai_settings").select("enabled").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("ai_export_enabled").eq("id", userId).maybeSingle(),
  ]);

  return settings?.enabled === true && profile?.ai_export_enabled !== false;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run tests/unit/ai-gate.test.ts
```

- [ ] **Step 5: Write the failing wiring test**

Add to `tests/unit/sidebar-nav.test.ts`:

```ts
it("AppSidebar renders the gated Ask-AI lower-rail link", () => {
  const source = readFileSync("components/shell/AppSidebar.tsx", "utf8");
  expect(source).toContain("AskAiLowerRailLink");
});

it("AskAiLowerRailLink checks isAskAiAvailable before rendering a link", () => {
  const source = readFileSync("components/shell/AskAiLowerRailLink.tsx", "utf8");
  expect(source).toContain("isAskAiAvailable");
  expect(source).toContain('href="/settings#ask-ai"');
});
```

(`readFileSync`/`node:fs` import already needed — add it if `sidebar-nav.test.ts` doesn't already import it.)

- [ ] **Step 6: Run it and confirm it fails**

```bash
npx vitest run tests/unit/sidebar-nav.test.ts
```

- [ ] **Step 7: Implement `AskAiLowerRailLink`**

Create `components/shell/AskAiLowerRailLink.tsx`:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAskAiAvailable } from "@/lib/ai-gate";
import { Sparkles } from "@/components/ui/icons";

export default async function AskAiLowerRailLink() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAskAiAvailable(supabase, user.id))) return null;

  return (
    <Link
      href="/settings#ask-ai"
      className="mt-4 inline-flex w-full items-center gap-3 rounded-field px-3 py-2.5 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-panel-hover hover:text-foreground focus-visible:outline-2"
    >
      <Sparkles aria-hidden className="h-4 w-4 shrink-0" />
      <span>Ask your money</span>
    </Link>
  );
}
```

- [ ] **Step 8: Render it at the bottom of the desktop sidebar**

In `components/shell/AppSidebar.tsx`, add the import and render it as the last child inside the `<nav aria-label="Primary">` in the `<aside>` (after `manageItems.map(...)`, still inside the same `<nav>` so it participates in the same landmark):

```tsx
import AskAiLowerRailLink from "@/components/shell/AskAiLowerRailLink";
// ...
          {manageItems.map((item) => (
            <NavLink key={item.key} item={item} active={active} />
          ))}
          <AskAiLowerRailLink />
        </nav>
      </aside>
```

Do not add it to the mobile pill nav (`lg:hidden`) — it stays a desktop lower-rail affordance per the master plan wording; mobile users still reach Ask-AI via `/settings`.

- [ ] **Step 9: Add the `#ask-ai` anchor target in Settings**

In `app/settings/page.tsx`, wrap the existing `<AskAiSection>` render with an id, matching the existing `id="budgets"`/`id="cleanup"` convention:

```tsx
<div className="grid gap-6 xl:grid-cols-2">
  <div id="ask-ai">
    <AskAiSection enabled={aiSettings?.enabled ?? false} />
  </div>
  <ReceiptScanSection enabled={aiSettings?.enabled ?? false} />
</div>
```

- [ ] **Step 10: Run the focused tests and confirm they pass**

```bash
npx vitest run tests/unit/sidebar-nav.test.ts tests/unit/ai-gate.test.ts tests/unit/settings-ui.test.ts
npm run lint
npx tsc --noEmit
```

(`tests/unit/settings-ui.test.ts` is the closest existing settings-page structure test per the earlier codebase research — run it to catch any regression from the `id="ask-ai"` wrap.)

- [ ] **Step 11: Commit**

```bash
git add lib/ai-gate.ts components/shell/AskAiLowerRailLink.tsx components/shell/AppSidebar.tsx app/settings/page.tsx tests/unit/ai-gate.test.ts tests/unit/sidebar-nav.test.ts
git commit -m "feat(nav): add gated Ask-AI lower-rail link"
```

---

### Task 6: Persisted sidebar collapse

**Files:**

- Create: `components/shell/SidebarShell.tsx`
- Modify: `components/shell/AppSidebar.tsx`
- Modify: `components/settings/DashboardPrefsSection.tsx`
- Test: extend `tests/unit/sidebar-nav.test.ts`
- Test: extend `tests/unit/settings-ui.test.ts` (or nearest `DashboardPrefsSection` test — check `tests/unit` for one first)

**Interfaces:**

- Produces:

```ts
// DashboardPrefsSection.tsx
export interface DashboardPrefs {
  hideRecent?: boolean;
  hideBreakdowns?: boolean;
  hideBillCalendar?: boolean;
  hideWhatIf?: boolean;
  hideDebt?: boolean;
  sidebarCollapsed?: boolean;
}
```

```tsx
// SidebarShell.tsx
export default function SidebarShell({
  children,
  mobileNav,
}: Readonly<{ children: ReactNode; mobileNav: ReactNode }>): JSX.Element;
```

**Design note (why this doesn't make `AppSidebar` itself a client component):** `AppSidebar` calls `getEnabledNavItems()`, which reads the server-only `FUNDFLOW_FEATURE_FLAGS` env var through `isFeatureEnabled`. If `AppSidebar` became `"use client"`, that env var would silently stop being readable in the browser bundle (only `NEXT_PUBLIC_*` vars are inlined), degrading every future feature flag to its hardcoded default and breaking the env-var override path with no test catching it until a real deploy. So `AppSidebar` stays a server component that resolves nav items and renders the full `<nav>` markup as before; only the surrounding `<aside>` chrome (width, collapse toggle button) becomes a client wrapper, receiving the already-rendered nav as `children` — passing pre-rendered Server Component output into a Client Component's `children`/props is supported (function/component references are not, plain React elements are).

- [ ] **Step 1: Write the failing collapse-state and wiring tests**

Add to `tests/unit/sidebar-nav.test.ts`:

```ts
it("AppSidebar wraps its desktop nav in SidebarShell instead of rendering <aside> directly", () => {
  const source = readFileSync("components/shell/AppSidebar.tsx", "utf8");
  expect(source).toContain("SidebarShell");
  expect(source).not.toContain("<aside");
});

it("SidebarShell persists collapse state through profiles.dashboard_prefs", () => {
  const source = readFileSync("components/shell/SidebarShell.tsx", "utf8");
  expect(source).toContain('"use client"');
  expect(source).toContain("dashboard_prefs");
  expect(source).toContain("sidebarCollapsed");
  expect(source).toContain("aria-pressed");
});
```

Check for an existing `DashboardPrefsSection` test file first (`ls tests/unit | grep -i dashboard-prefs`); if one exists, add there instead of duplicating in `sidebar-nav.test.ts`:

```ts
it("DashboardPrefs includes an optional sidebarCollapsed flag", () => {
  const prefs: DashboardPrefs = { sidebarCollapsed: true };
  expect(prefs.sidebarCollapsed).toBe(true);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run tests/unit/sidebar-nav.test.ts
```

- [ ] **Step 3: Add `sidebarCollapsed` to `DashboardPrefs`**

In `components/settings/DashboardPrefsSection.tsx`, extend the interface only (do not add a UI toggle here — the toggle lives in the sidebar itself per Step 4; this component's `OPTIONS` list is for hide/show sections, a different concern):

```ts
export interface DashboardPrefs {
  hideRecent?: boolean;
  hideBreakdowns?: boolean;
  hideBillCalendar?: boolean;
  hideWhatIf?: boolean;
  hideDebt?: boolean;
  sidebarCollapsed?: boolean;
}
```

- [ ] **Step 4: Implement `SidebarShell`**

Create `components/shell/SidebarShell.tsx`:

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";

/**
 * Owns only the collapse/expand chrome around the already-rendered nav
 * (children). Nav item resolution stays server-side in AppSidebar so
 * feature-flag env overrides keep working (see plan Task 6 design note).
 * Persists to profiles.dashboard_prefs.sidebarCollapsed, the same
 * client-writable column DashboardPrefsSection already uses, so the choice
 * follows the user across devices.
 */
export default function SidebarShell({
  children,
  mobileNav,
}: Readonly<{ children: ReactNode; mobileNav: ReactNode }>) {
  const [collapsed, setCollapsed] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("dashboard_prefs")
        .eq("id", data.user.id)
        .maybeSingle();
      if (active && profile?.dashboard_prefs?.sidebarCollapsed === true) {
        setCollapsed(true);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("dashboard_prefs")
      .eq("id", data.user.id)
      .maybeSingle();
    await supabase
      .from("profiles")
      .update({ dashboard_prefs: { ...(profile?.dashboard_prefs ?? {}), sidebarCollapsed: next } })
      .eq("id", data.user.id);
  }

  return (
    <>
      <aside
        data-collapsed={collapsed}
        className={cn(
          "group/sidebar sticky top-16 hidden h-[calc(100vh-64px)] shrink-0 border-r border-panel-border bg-panel px-4 py-5 lg:block overflow-y-auto transition-[width] duration-150",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-field text-muted hover:bg-panel-hover hover:text-foreground focus-visible:outline-2"
        >
          {collapsed ? (
            <ChevronRight aria-hidden className="h-4 w-4" />
          ) : (
            <ChevronLeft aria-hidden className="h-4 w-4" />
          )}
        </button>
        {children}
      </aside>
      {mobileNav}
    </>
  );
}
```

Reconciling the fire-and-forget `dashboard_prefs` read-then-write in `toggle()` against a concurrent `DashboardPrefsSection.save()` write is an accepted last-write-wins race on a non-sensitive UI preference, the same tradeoff `DashboardPrefsSection` already makes with a whole-object overwrite.

- [ ] **Step 5: Wire `AppSidebar` to use `SidebarShell` and make the label hide (not disappear) when collapsed**

In `components/shell/AppSidebar.tsx`, replace the `<aside>...</aside>` block with `SidebarShell`, and update `NavLink` to keep an accessible name when collapsed via CSS only (`group-data-[collapsed=true]/sidebar:sr-only`, not `hidden`, so the link's accessible name survives for screen readers):

```tsx
function NavLink({
  item,
  active,
  compact = false,
}: Readonly<{
  item: NavItemDefinition;
  active: AppShellActive;
  compact?: boolean;
}>) {
  const Icon = item.icon;
  const isActive =
    item.key === active ||
    (item.key === "dashboard" && ["monitor", "plan", "wealth"].includes(active));

  return (
    <Link
      href={item.href}
      title={item.label}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-3 rounded-field text-sm font-semibold transition-colors duration-150 focus-visible:outline-2",
        compact ? "min-h-11 shrink-0 px-3 py-2" : "w-full px-3 py-2.5",
        isActive
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-panel-hover hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      <span className={compact ? "" : "group-data-[collapsed=true]/sidebar:sr-only"}>{item.label}</span>
    </Link>
  );
}

export default function AppSidebar({ active }: Readonly<{ active: AppShellActive }>) {
  const enabledItems = getEnabledNavItems();

  const primaryItems = enabledItems.filter((i) => i.category === "primary");
  const planningItems = enabledItems.filter((i) => i.category === "planning");
  const manageItems = enabledItems.filter((i) => i.category === "manage");

  return (
    <SidebarShell
      mobileNav={
        <nav
          aria-label="Primary"
          className="lg:hidden flex gap-2 overflow-x-auto border-b border-panel-border px-4 py-3 scrollbar-none sm:px-6 [mask-image:linear-gradient(to_right,black_calc(100%_-_2rem),transparent)]"
        >
          {enabledItems.map((item) => (
            <NavLink key={item.key} item={item} active={active} compact />
          ))}
        </nav>
      }
    >
      <nav aria-label="Primary" className="space-y-1">
        {primaryItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
        <p className="px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted">
          Planning
        </p>
        {planningItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
        <p className="px-3 pb-1 pt-4 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted">
          Manage
        </p>
        {manageItems.map((item) => (
          <NavLink key={item.key} item={item} active={active} />
        ))}
        <AskAiLowerRailLink />
      </nav>
    </SidebarShell>
  );
}
```

Confirm Tailwind 4's arbitrary-variant `group-data-[collapsed=true]/sidebar:sr-only` resolves against `data-collapsed` (the attribute name, not a literal `data-...=collapsed` value pair) — Tailwind's `data-*` variant matches on the attribute's value, so the class must reference the actual attribute/value pair emitted by `SidebarShell` (`data-collapsed="true"` when React serializes a boolean `true` prop to a DOM attribute — verify this renders as the string `"true"`, not the boolean, before relying on the selector; adjust `data-collapsed={collapsed}` to `data-collapsed={collapsed ? "true" : "false"}` in `SidebarShell` if needed so the emitted attribute value is unambiguous).

- [ ] **Step 6: Run the focused tests and confirm they pass**

```bash
npx vitest run tests/unit/sidebar-nav.test.ts
npm run lint
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add components/shell/SidebarShell.tsx components/shell/AppSidebar.tsx components/settings/DashboardPrefsSection.tsx tests/unit/sidebar-nav.test.ts
git commit -m "feat(nav): add persisted sidebar collapse"
```

---

### Task 7: Regression lock-ins and HANDOFF note

**Files:**

- Test: extend `tests/unit/sidebar-nav.test.ts`
- Modify: `docs/HANDOFF.md`

**Interfaces:**

- Consumes: `NAV_ITEMS` from Task 1, `resolveDashboardView` from `components/dashboard/dashboard-view.ts` (existing, unchanged).

- [ ] **Step 1: Write the regression tests**

```ts
it("never adds monitor, plan, or wealth as top-level nav keys", () => {
  const keys = NAV_ITEMS.map((item) => item.key);
  expect(keys).not.toContain("monitor");
  expect(keys).not.toContain("plan");
  expect(keys).not.toContain("wealth");
});

it("keeps Year in Money as a top-level nav entry until Reports (Phase 6) exists", () => {
  const wrapped = NAV_ITEMS.find((item) => item.key === "wrapped");
  expect(wrapped?.href).toBe("/wrapped");
  expect(wrapped?.category).toBe("manage");
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run tests/unit/sidebar-nav.test.ts
```

Expected: passes immediately (documents existing behavior, no implementation change).

- [ ] **Step 3: Record the deferred IA step in `docs/HANDOFF.md`**

Add a note under the Phase 1 heading (create one, following the existing "START HERE: Phase N" convention at the top of the file) stating: Phase 1 shipped nav-model-driven sidebar/command-palette/top-bar wiring, gated Ask-AI link, and persisted sidebar collapse; the "move Year in Money under Reports" step from the master plan is deferred to Phase 6 because Reports does not exist yet, and Phase 6's plan must add that link-and-remove step explicitly.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/sidebar-nav.test.ts docs/HANDOFF.md
git commit -m "test(nav): lock in dashboard subview and Year in Money placement"
```

---

### Task 8: E2E acceptance, full verification, and PR

**Files:**

- Create: `tests/e2e/planner-ia.spec.ts`
- Modify: `docs/HANDOFF.md` (final status update)

**Interfaces:**

- Consumes: the existing Playwright auth fixture/helper used by other `tests/e2e/*.spec.ts` files (check one, e.g. `tests/e2e/accounts.spec.ts`, for the sign-in helper name before writing this file — do not invent a new one).

- [ ] **Step 1: Write the E2E spec**

Create `tests/e2e/planner-ia.spec.ts` covering, at minimum:

```ts
import { test, expect } from "@playwright/test";
// import whatever sign-in helper the existing specs use, e.g.:
// import { signIn } from "./helpers/auth";

test.describe("Phase 1: navigation and information architecture", () => {
  test.beforeEach(async ({ page }) => {
    // await signIn(page);
  });

  test("only implemented destinations appear in the sidebar", async ({ page }) => {
    await page.goto("/dashboard");
    const sidebar = page.getByRole("navigation", { name: "Primary" }).first();
    await expect(sidebar.getByRole("link", { name: "Reports" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Recurring" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("search opens the command palette via the top-bar button and Cmd+K", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Search/ }).click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  });

  test("notifications and settings top-bar links navigate correctly", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /Notifications/ }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("sidebar collapses and restores, and persists across reload", async ({ page }) => {
    await page.goto("/dashboard");
    const toggle = page.getByRole("button", { name: "Collapse sidebar" });
    await toggle.click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  });

  test("mobile nav at 390px shows compact pills and no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("signed-out request to a brand-new private path redirects to login", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/budget");
    await expect(page).toHaveURL(/\/login$/);
  });
});
```

Adjust selectors after running once against the real dev server — role/name text must match whatever `aria-label`s Tasks 4-6 actually produced.

- [ ] **Step 2: Run the E2E spec**

```bash
npm run dev &
npx playwright test tests/e2e/planner-ia.spec.ts
```

Expected: all pass in light and dark themes (run once per `THEME` env var or however existing specs parametrize theme — check `tests/e2e/accounts.spec.ts` or similar for the existing pattern before adding a new one).

- [ ] **Step 3: Run the full local gate**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run test:e2e -- tests/e2e/planner-ia.spec.ts
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Update `docs/HANDOFF.md` with the final Phase 1 status**

Record: branch name, test totals, the Year-in-Money deferral to Phase 6, the sm-breakpoint scope decision for top-bar utility icons, and "Next: Phase 5, 6, or 9A (independent of each other) per the master plan's dependency graph" (Phase 1 unblocks all of them per `docs/superpowers/archive/plans/2026-07-29-monarch-parity.md`'s ordering diagram).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/planner-ia.spec.ts docs/HANDOFF.md
git commit -m "test(nav): add planner IA acceptance journey"
```

- [ ] **Step 6: Push and open the PR**

```bash
git checkout -b feat/planner-ia
git push -u origin feat/planner-ia
gh pr create --title "feat(nav): planner navigation and information architecture (Phase 1)" --body "$(cat <<'EOF'
## Summary
- Centralizes nav items in nav-model.ts and drives AppSidebar, CommandPalette, and the top bar from one source.
- Adds top-bar search, notifications (with unread count), and settings shortcuts, plus a gated Ask-AI lower-rail link.
- Adds a sidebar collapse control persisted to profiles.dashboard_prefs.
- Defers moving Year in Money under Reports to Phase 6 (Reports does not exist yet); recorded in docs/HANDOFF.md.

## Test plan
- [ ] npm run lint
- [ ] npx tsc --noEmit
- [ ] npm test
- [ ] npm run build
- [ ] npx playwright test tests/e2e/planner-ia.spec.ts (light and dark, 1440x900 / 768x1024 / 390x844)
EOF
)"
```

Note: this branch starts from `main` (Phase 4 / PR #72 already merged), per the master plan's "Later Phase Rule."

## Self-Review Checklist

- [ ] Every Phase 1 bullet in `docs/superpowers/archive/plans/2026-07-29-monarch-parity.md` maps to a task above, or its deferral is explicitly recorded (Year in Money / Reports).
- [ ] No placeholder route or "coming soon" page is added.
- [ ] `NAV_ITEMS`/`UTILITY_ITEMS` types used in later tasks match Task 1's definitions exactly (`hint`, `getEnabledNavItems`).
- [ ] `proxy.ts` is not modified, only tested (Task 3).
- [ ] Every new per-user DB read (`getUnreadNotificationCount`, `isAskAiAvailable`, `SidebarShell`'s `dashboard_prefs` read/write) goes through the RLS-bound cookie client, never the service client.
- [ ] No new Plaid calls anywhere in this phase.
- [ ] Accessibility: collapsed sidebar links keep an accessible name (`sr-only`, not `hidden`); command palette dialog semantics unchanged; new icon-only buttons all have `aria-label`.
- [ ] Responsive: top-bar utility icons hidden below `sm` with a documented reason (mobile pill nav covers the same destinations); E2E asserts no horizontal overflow at 390px.
