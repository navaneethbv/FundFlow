-- ---------------------------------------------------------------------------
-- 20260810110000_plaid_link_token_binding: persist a hashed record of every
-- Plaid link token, bound to the user it was created for, so the exchange step
-- can verify the submitted public token came from a link token this user
-- actually created (and that it is single-use). APPLY BEFORE DEPLOYING.
-- ---------------------------------------------------------------------------

create table public.plaid_link_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  token_hash  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  consumed_at timestamptz
);
create index plaid_link_tokens_user_id_idx on public.plaid_link_tokens (user_id);
create unique index plaid_link_tokens_hash_uidx on public.plaid_link_tokens (token_hash);

alter table public.plaid_link_tokens enable row level security;
revoke all on table public.plaid_link_tokens from anon;
revoke all on table public.plaid_link_tokens from public;

-- The app writes/consumes via the service client; the owner-select policy only
-- keeps the table out of the deny-by-default case and mirrors the client
-- surface used elsewhere. Rows carry a token HASH, never the token itself.
create policy "plaid_link_tokens_select_own" on public.plaid_link_tokens
  for select to authenticated using (user_id = (select auth.uid()));
