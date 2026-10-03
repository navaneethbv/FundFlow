-- Checklist 13.6: private PDF statement metadata and coverage grid.
-- Statement bytes live in a private storage bucket; this table never parses them.

create table if not exists public.account_statements (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  account_id         uuid references public.accounts (id) on delete cascade,
  manual_account_id  uuid references public.manual_accounts (id) on delete cascade,
  statement_month    date not null,
  storage_path       text not null unique,
  original_filename  text not null,
  content_type       text not null default 'application/pdf',
  size_bytes         integer not null,
  created_at         timestamptz not null default now(),
  constraint account_statements_one_account
    check (
      (case when account_id is not null then 1 else 0 end) +
      (case when manual_account_id is not null then 1 else 0 end) = 1
    ),
  constraint account_statements_month_start
    check (statement_month = date_trunc('month', statement_month)::date),
  constraint account_statements_pdf_only
    check (content_type = 'application/pdf' and size_bytes > 0 and size_bytes <= 15728640)
);

create index if not exists account_statements_user_month_idx
  on public.account_statements (user_id, statement_month desc);
create index if not exists account_statements_account_month_idx
  on public.account_statements (account_id, manual_account_id, statement_month desc);

alter table public.account_statements enable row level security;
revoke all on table public.account_statements from anon;
grant select on table public.account_statements to authenticated;

create policy "account_statements_select_own" on public.account_statements
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.session_not_revoked())
    and (select private.mfa_satisfied())
  );

insert into storage.buckets (id, name, public)
values ('statements', 'statements', false)
on conflict (id) do nothing;

-- Browser clients never receive statement write access. Route handlers use the
-- service client only after checking the signed-in user's account ownership.

-- Verification (expect no rows):
-- select count(*) from public.account_statements
-- where (account_id is null) = (manual_account_id is null)
--    or statement_month <> date_trunc('month', statement_month)::date;

-- Rollback:
-- delete from storage.buckets where id = 'statements';
-- drop table if exists public.account_statements;
