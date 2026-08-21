# Budget Templates and Month-to-Month Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save a budget template (per-group/category planned amounts) and apply it — or copy last month's numbers directly — to seed a new month's envelopes, without disturbing existing rollover choices, and with an explicit overwrite-vs-merge prompt whenever the target month already has envelopes.

**Architecture:** A new `budget_templates`/`budget_template_items` pair stores saved templates. A single new `security definer` Postgres RPC, `apply_budget_month(p_source, p_target_month, p_mode)`, does the actual bulk write server-side in one transaction — reusing the exact upsert semantics `update_budget_period` already established — so "copy last month" and "apply template" are two thin callers of the same primitive rather than two different write paths.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres, Vitest.

**Spec:** `/Users/navaneethbv/Desktop/Projects/FundFlow/features.md` §4 ("Budget templates and month-to-month copy").

## Global Constraints

- Client writes to `budgets`/`budget_periods` are allowed directly (this app's one explicit exception to "route handles every write") — but a *bulk* multi-row write belongs in a `security definer` RPC, matching `update_budget_period`'s and `budget_suggestion_history`'s precedent, not a client-side loop of individual upserts.
- Every RPC: `security definer`, `set search_path = ''`, `revoke all ... from public, anon`, `grant execute ... to authenticated`.
- The existing per-row `rollover_enabled` flag must survive a template apply or month copy untouched — templates/copies seed `planned` amounts and `group_name`/`sort_order`, never `rollover_enabled`.
- Route handlers: `requireUser()` → early-return the `NextResponse` → `badRequest()` → work → `writeAudit()` → JSON, wrapped so failures hit `errorResponse(context, error)`.
- Create migrations with `npx supabase migration new <slug>`; apply by hand before code reads the table.
- Tests mock with `vi.mock` and import route handlers directly, using `tests/fixtures/supabase-query.ts`.
- `npm run lint`, `npm test`, and `npm run build` must pass before this is done.

---

### Task 1: Add the template schema and the apply/copy RPC

**Files:**

- Create with Supabase CLI: migration slug `budget_templates`
- Modify: `tests/unit/roadmap-schema-completion.test.ts` (or the nearest schema-assertion test file)

**Interfaces:** `apply_budget_month(p_template_id uuid, p_source_month date, p_target_month date, p_mode text) returns table (category text, planned numeric, group_name text, sort_order int)` — exactly one of `p_template_id`/`p_source_month` is passed (template-apply vs. copy-last-month), `p_mode` is `'merge'` or `'overwrite'`.

- [ ] Write failing schema tests asserting: `budget_templates` has `id, user_id, name, created_at, updated_at` with `unique (user_id, name)`; `budget_template_items` has `id, template_id, category, planned, group_name, sort_order` with `unique (template_id, category)` and a FK to `budget_templates(id) on delete cascade`; both tables have RLS enabled with `authenticated` granted `select, insert, update, delete`, scoped to the caller owning the parent template; `apply_budget_month` exists, is `security definer`, and `EXECUTE` is granted only to `authenticated`.
- [ ] Run the focused test and confirm failure.
- [ ] Generate the migration:
  ```sql
  create table public.budget_templates (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    name        text not null check (char_length(name) between 1 and 80),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (user_id, name)
  );

  create table public.budget_template_items (
    id           uuid primary key default gen_random_uuid(),
    template_id  uuid not null references public.budget_templates (id) on delete cascade,
    category     text not null,
    planned      numeric(14, 2) not null check (planned >= 0),
    group_name   text not null default 'flexible'
      check (group_name in ('income', 'fixed', 'flexible', 'non_monthly')),
    sort_order   int not null default 0,
    unique (template_id, category)
  );

  create trigger budget_templates_set_updated_at
    before update on public.budget_templates
    for each row execute function public.set_updated_at();

  grant select, insert, update, delete on public.budget_templates to authenticated;
  grant select, insert, update, delete on public.budget_template_items to authenticated;
  alter table public.budget_templates enable row level security;
  alter table public.budget_template_items enable row level security;

  create policy "budget_templates_all_own" on public.budget_templates
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

  create policy "budget_template_items_all_own" on public.budget_template_items
    for all to authenticated
    using (exists (
      select 1 from public.budget_templates t
      where t.id = budget_template_items.template_id and t.user_id = (select auth.uid())
    ))
    with check (exists (
      select 1 from public.budget_templates t
      where t.id = budget_template_items.template_id and t.user_id = (select auth.uid())
    ));

  create or replace function public.apply_budget_month(
    p_template_id uuid default null,
    p_source_month date default null,
    p_target_month date default null,
    p_mode text default 'merge'
  ) returns table (category text, planned numeric, group_name text, sort_order integer)
  language plpgsql security invoker set search_path = ''
  as $$
  declare
    v_user_id uuid := (select auth.uid());
    v_source record;
  begin
    if p_target_month is null or p_target_month <> date_trunc('month', p_target_month)::date then
      raise exception 'invalid_target_month' using errcode = '22023';
    end if;
    if p_mode not in ('merge', 'overwrite') then
      raise exception 'invalid_mode' using errcode = '22023';
    end if;
    if (p_template_id is null) = (p_source_month is null) then
      raise exception 'exactly_one_source_required' using errcode = '22023';
    end if;

    if p_mode = 'overwrite' then
      delete from public.budget_periods bp
      using public.budgets b
      where bp.budget_id = b.id
        and b.user_id = v_user_id
        and bp.month = p_target_month;
    end if;

    if p_template_id is not null then
      if not exists (select 1 from public.budget_templates t where t.id = p_template_id and t.user_id = v_user_id) then
        raise exception 'template_not_found' using errcode = 'P0002';
      end if;
      for v_source in
        select i.category, i.planned, i.group_name, i.sort_order
        from public.budget_template_items i
        where i.template_id = p_template_id
      loop
        insert into public.budgets (user_id, category, monthly_limit, group_name, sort_order)
        values (v_user_id, v_source.category, v_source.planned, v_source.group_name, v_source.sort_order)
        on conflict (user_id, category) do update
          set group_name = excluded.group_name, sort_order = excluded.sort_order
        returning id into strict v_source.category; -- placeholder assignment, replaced below

        insert into public.budget_periods (user_id, budget_id, month, planned)
        select v_user_id, b.id, p_target_month, v_source.planned
        from public.budgets b where b.user_id = v_user_id and b.category = v_source.category
        on conflict (budget_id, month) do update set planned = excluded.planned;
      end loop;
    else
      for v_source in
        select b.category, bp.planned, b.group_name, b.sort_order
        from public.budget_periods bp
        join public.budgets b on b.id = bp.budget_id
        where b.user_id = v_user_id and bp.month = p_source_month
      loop
        insert into public.budgets (user_id, category, monthly_limit, group_name, sort_order)
        values (v_user_id, v_source.category, v_source.planned, v_source.group_name, v_source.sort_order)
        on conflict (user_id, category) do nothing;

        insert into public.budget_periods (user_id, budget_id, month, planned)
        select v_user_id, b.id, p_target_month, v_source.planned
        from public.budgets b where b.user_id = v_user_id and b.category = v_source.category
        on conflict (budget_id, month) do update set planned = excluded.planned;
      end loop;
    end if;

    return query
      select b.category, bp.planned, b.group_name, b.sort_order
      from public.budget_periods bp
      join public.budgets b on b.id = bp.budget_id
      where b.user_id = v_user_id and bp.month = p_target_month
      order by b.sort_order, b.category;
  end;
  $$;

  revoke all on function public.apply_budget_month(uuid, date, date, text) from public, anon;
  grant execute on function public.apply_budget_month(uuid, date, date, text) to authenticated;
  ```
  Note: the `returning id into strict v_source.category` line above is wrong SQL (a record field can't be a `returning into` target) — replace it during implementation with a real `v_budget_id uuid` local variable captured from the `insert ... returning id into v_budget_id`, then use `v_budget_id` in the following `budget_periods` insert instead of re-selecting `budgets` by category. Write the schema test in the first step to catch exactly this class of bug (call the RPC in a `select` smoke test, not just assert it exists) before treating this task as done.
- [ ] Apply the migration and verify the tables, RLS, and function grants.
- [ ] Run the focused schema test again and confirm it passes, including a real invocation of `apply_budget_month` against seeded rows proving both the `template_id` and `source_month` paths write correct `budget_periods` rows.
- [ ] Add `budget_templates` and `budget_template_items` to `USER_DATA_TABLES` in `lib/user-data.ts`.
- [ ] Commit with `feat(budget-templates): add template schema and apply RPC`.

### Task 2: Implement template CRUD in `lib/budget-page.ts`

**Files:**

- Modify: `lib/budget-page.ts`
- Modify: `tests/unit/budget-page.test.ts` (or the nearest existing test file for `lib/budget-page.ts`)

**Interfaces:** `buildTemplateFromCurrentMonth(rows: BudgetRow[]): BudgetTemplateDraft` — a pure function turning the current month's `budgets`+`budget_periods` join into the shape the create-template route will insert, so the "save this month as a template" UI action has real logic to test rather than a bare passthrough.

- [ ] Write failing tests: `buildTemplateFromCurrentMonth` maps each budget row's `category`/`planned`/`group_name`/`sort_order` into a `BudgetTemplateDraft.items` entry, excludes rows with `planned === 0` (an empty envelope isn't worth templating), and is stable under input reordering (output sorted by `sort_order` then `category`).
- [ ] Run the focused test and confirm failure.
- [ ] Implement `buildTemplateFromCurrentMonth` in `lib/budget-page.ts` alongside the existing `proposeBudgetFromHistory`.
- [ ] Run the test again and confirm it passes.
- [ ] Commit with `feat(budget-templates): add template-draft builder`.

### Task 3: Implement the template and apply routes

**Files:**

- Create: `app/api/budget/templates/route.ts`
- Create: `app/api/budget/apply/route.ts`
- Create: `tests/unit/budget-templates-routes.test.ts`
- Modify: `lib/audit.ts`

**Interfaces:** `GET`/`POST`/`DELETE /api/budget/templates` (list, create-from-current-month, delete); `POST /api/budget/apply` with body `{ template_id?: string; source_month?: string; target_month: string; mode: "merge" | "overwrite" }` calling the `apply_budget_month` RPC.

- [ ] Add `"budget_template_created"`, `"budget_template_deleted"`, and `"budget_month_applied"` to the `AuditAction` union in `lib/audit.ts`.
- [ ] Write failing tests covering: `POST /api/budget/templates` validates `name` (1-80 chars) and a non-empty `items` list, rejects a duplicate name with `400` (translating the `23505` unique-violation), and audits `"budget_template_created"`; `DELETE` scopes by `id` and `user_id`, audits `"budget_template_deleted"`; `POST /api/budget/apply` validates `target_month` is `YYYY-MM` and normalizes it to the first-of-month date the RPC expects, validates exactly one of `template_id`/`source_month` is present, validates `mode` is `"merge"` or `"overwrite"`, calls the RPC via the RLS-scoped `supabase` client (this is `security invoker`, so it runs as the caller and needs no service-client indirection), and audits `"budget_month_applied"` with `{ mode, target_month, template_id_or_source_month }` in `metadata`; the RPC's `template_not_found` error becomes a route `404`, not a `500`.
- [ ] Run the test file and confirm failure.
- [ ] Implement both routes following `app/api/budget/route.ts`'s validate → RPC/write → audit shape.
- [ ] Run the test file again and confirm it passes.
- [ ] Commit with `feat(budget-templates): add template and apply routes`.

### Task 4: Build the template and copy UI

**Files:**

- Modify: `components/budget/BudgetPlanner.tsx` (or wherever the Budget page's month-header actions currently live — locate the component `app/budget/page.tsx` renders and add to its action row)
- Create: `components/budget/BudgetTemplateMenu.tsx`

**Interfaces:** `BudgetTemplateMenu` is a client component rendering three actions in the Budget page header: "Save as template", "Apply template" (with a template picker), and "Copy last month" — each posting to the routes from Task 3.

- [ ] Build `BudgetTemplateMenu`: "Save as template" opens a small name-input dialog, `POST`s to `/api/budget/templates` with the current month's rows (fetched from the page's already-loaded budget data, via `buildTemplateFromCurrentMonth`); "Apply template" and "Copy last month" both `POST` to `/api/budget/apply` — before submitting, check (client-side, from data the page already has) whether the target month already has any `budget_periods` rows, and if so show a native `confirm()`-style choice between "Merge" and "Overwrite" (mirroring the acceptance criterion "overwrite/merge choice is explicit and never destructive without confirmation" — use the same `window.confirm`-gated pattern `DangerZone.tsx` uses for its destructive action, adapted to a two-way choice via two buttons in a small dialog rather than a single confirm).
- [ ] Wire the menu into the Budget page's action row, `router.refresh()` on success from any of the three actions.
- [ ] Verify by hand in the dev server: saving a template preserves rollover flags on the source month untouched; applying a template to an empty month seeds exactly its saved amounts; applying to a month with existing envelopes prompts and respects the merge/overwrite choice; light/dark themes; 375px mobile layout.
- [ ] Commit with `feat(budget-templates): add template and copy UI`.

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] Run `npm run lint`, `npm run test:unit`, and `npm run build`; fix anything this feature introduced.
- [ ] Manually verify the three acceptance criteria from `features.md` §4: template applies to a fresh month deterministically (same inputs twice produce the same `budget_periods` state); copy-last-month reproduces exact planned values and group assignments; the overwrite/merge choice is never bypassed silently.
- [ ] Add an RLS integration test (if `.env.local` + applied migrations are available) proving user B cannot read, apply, or delete user A's templates, and that `apply_budget_month` only ever touches the caller's own `budgets`/`budget_periods` rows.
- [ ] Update `docs/HANDOFF.md` and `docs/TODO.md`.
