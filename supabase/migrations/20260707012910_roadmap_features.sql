-- ---------------------------------------------------------------------------
-- roadmap_features: planning, review, alerts, imports, and household support
--
-- All tables in this migration are user-owned or household-owned and exposed
-- through the Supabase Data API, so each table gets explicit authenticated
-- grants plus RLS policies. RLS controls rows; grants control table access.
-- ---------------------------------------------------------------------------

create table public.merchant_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  match_type    text not null check (match_type in ('merchant', 'keyword', 'account')),
  pattern       text not null check (char_length(pattern) between 1 and 160),
  display_name  text,
  category      text,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.manual_accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 120),
  account_type          text not null check (account_type in ('asset', 'liability', 'cash', 'investment', 'debt')),
  balance               numeric(14, 2) not null default 0,
  include_in_net_worth  boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.net_worth_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  snapshot_month  date not null,
  assets          numeric(14, 2) not null default 0 check (assets >= 0),
  liabilities     numeric(14, 2) not null default 0 check (liabilities >= 0),
  created_at      timestamptz not null default now(),
  unique (user_id, snapshot_month)
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null check (char_length(type) between 1 and 80),
  severity    text not null check (severity in ('info', 'success', 'warning', 'danger')),
  title       text not null check (char_length(title) between 1 and 160),
  body        text not null check (char_length(body) between 1 and 500),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table public.alert_preferences (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  broken_bank         boolean not null default true,
  budget_exceeded     boolean not null default true,
  goal_reached        boolean not null default true,
  large_transaction   boolean not null default false,
  low_cash_forecast   boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.ai_settings (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  enabled     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.ai_insights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  insight_type  text not null check (char_length(insight_type) between 1 and 80),
  summary       text not null check (char_length(summary) between 1 and 1200),
  source_month  date,
  created_at    timestamptz not null default now()
);

create table public.import_review_batches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  file_name   text not null check (char_length(file_name) between 1 and 240),
  status      text not null default 'pending' check (status in ('pending', 'committed', 'discarded')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.import_review_rows (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  batch_id     uuid not null references public.import_review_batches (id) on delete cascade,
  row_hash     text not null,
  date         date not null,
  description  text not null,
  amount       numeric(14, 2) not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'committed')),
  created_at   timestamptz not null default now(),
  unique (user_id, row_hash)
);

create table public.households (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null check (role in ('owner', 'member', 'read_only')),
  status        text not null default 'active' check (status in ('invited', 'active', 'removed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, user_id)
);

create table public.manual_recurring_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 140),
  amount      numeric(14, 2) not null,
  frequency   text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  next_date   date not null,
  item_type   text not null check (item_type in ('income', 'expense')),
  category    text,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index merchant_rules_user_id_idx on public.merchant_rules (user_id);
create index manual_accounts_user_id_idx on public.manual_accounts (user_id);
create index net_worth_snapshots_user_month_idx on public.net_worth_snapshots (user_id, snapshot_month);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index ai_insights_user_created_idx on public.ai_insights (user_id, created_at desc);
create index import_review_batches_user_id_idx on public.import_review_batches (user_id);
create index import_review_rows_user_batch_idx on public.import_review_rows (user_id, batch_id);
create index households_owner_user_id_idx on public.households (owner_user_id);
create index household_members_user_id_idx on public.household_members (user_id);
create index household_members_household_id_idx on public.household_members (household_id);
create index manual_recurring_items_user_next_idx on public.manual_recurring_items (user_id, next_date);

create trigger merchant_rules_set_updated_at
  before update on public.merchant_rules
  for each row execute function public.set_updated_at();
create trigger manual_accounts_set_updated_at
  before update on public.manual_accounts
  for each row execute function public.set_updated_at();
create trigger alert_preferences_set_updated_at
  before update on public.alert_preferences
  for each row execute function public.set_updated_at();
create trigger ai_settings_set_updated_at
  before update on public.ai_settings
  for each row execute function public.set_updated_at();
create trigger import_review_batches_set_updated_at
  before update on public.import_review_batches
  for each row execute function public.set_updated_at();
create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();
create trigger household_members_set_updated_at
  before update on public.household_members
  for each row execute function public.set_updated_at();
create trigger manual_recurring_items_set_updated_at
  before update on public.manual_recurring_items
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.merchant_rules to authenticated;
grant select, insert, update, delete on public.manual_accounts to authenticated;
grant select, insert, update, delete on public.net_worth_snapshots to authenticated;
grant select, insert, update, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.alert_preferences to authenticated;
grant select, insert, update, delete on public.ai_settings to authenticated;
grant select, insert, update, delete on public.ai_insights to authenticated;
grant select, insert, update, delete on public.import_review_batches to authenticated;
grant select, insert, update, delete on public.import_review_rows to authenticated;
grant select, insert, update, delete on public.households to authenticated;
grant select, insert, update, delete on public.household_members to authenticated;
grant select, insert, update, delete on public.manual_recurring_items to authenticated;

alter table public.merchant_rules enable row level security;
alter table public.manual_accounts enable row level security;
alter table public.net_worth_snapshots enable row level security;
alter table public.notifications enable row level security;
alter table public.alert_preferences enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_insights enable row level security;
alter table public.import_review_batches enable row level security;
alter table public.import_review_rows enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.manual_recurring_items enable row level security;

create policy "merchant_rules_select_own" on public.merchant_rules
  for select to authenticated using (user_id = (select auth.uid()));
create policy "merchant_rules_insert_own" on public.merchant_rules
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "merchant_rules_update_own" on public.merchant_rules
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "merchant_rules_delete_own" on public.merchant_rules
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "manual_accounts_select_own" on public.manual_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "manual_accounts_insert_own" on public.manual_accounts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "manual_accounts_update_own" on public.manual_accounts
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "manual_accounts_delete_own" on public.manual_accounts
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "net_worth_snapshots_select_own" on public.net_worth_snapshots
  for select to authenticated using (user_id = (select auth.uid()));
create policy "net_worth_snapshots_insert_own" on public.net_worth_snapshots
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "net_worth_snapshots_update_own" on public.net_worth_snapshots
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "net_worth_snapshots_delete_own" on public.net_worth_snapshots
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "notifications_select_own" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications_insert_own" on public.notifications
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notifications_update_own" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications_delete_own" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "alert_preferences_select_own" on public.alert_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "alert_preferences_insert_own" on public.alert_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "alert_preferences_update_own" on public.alert_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "alert_preferences_delete_own" on public.alert_preferences
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "ai_settings_select_own" on public.ai_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "ai_settings_insert_own" on public.ai_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "ai_settings_update_own" on public.ai_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "ai_settings_delete_own" on public.ai_settings
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "ai_insights_select_own" on public.ai_insights
  for select to authenticated using (user_id = (select auth.uid()));
create policy "ai_insights_insert_own" on public.ai_insights
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "ai_insights_update_own" on public.ai_insights
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "ai_insights_delete_own" on public.ai_insights
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "import_review_batches_select_own" on public.import_review_batches
  for select to authenticated using (user_id = (select auth.uid()));
create policy "import_review_batches_insert_own" on public.import_review_batches
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "import_review_batches_update_own" on public.import_review_batches
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "import_review_batches_delete_own" on public.import_review_batches
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "import_review_rows_select_own" on public.import_review_rows
  for select to authenticated using (user_id = (select auth.uid()));
create policy "import_review_rows_insert_own" on public.import_review_rows
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "import_review_rows_update_own" on public.import_review_rows
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "import_review_rows_delete_own" on public.import_review_rows
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "households_select_own" on public.households
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy "households_insert_own" on public.households
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy "households_update_own" on public.households
  for update to authenticated using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
create policy "households_delete_own" on public.households
  for delete to authenticated using (owner_user_id = (select auth.uid()));

create policy "household_members_select_visible" on public.household_members
  for select to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.households h
      where h.id = household_id and h.owner_user_id = (select auth.uid())
    )
  );
create policy "household_members_insert_visible" on public.household_members
  for insert to authenticated with check (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.households h
      where h.id = household_id and h.owner_user_id = (select auth.uid())
    )
  );
create policy "household_members_update_visible" on public.household_members
  for update to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.households h
      where h.id = household_id and h.owner_user_id = (select auth.uid())
    )
  ) with check (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.households h
      where h.id = household_id and h.owner_user_id = (select auth.uid())
    )
  );
create policy "household_members_delete_visible" on public.household_members
  for delete to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.households h
      where h.id = household_id and h.owner_user_id = (select auth.uid())
    )
  );

create policy "manual_recurring_items_select_own" on public.manual_recurring_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "manual_recurring_items_insert_own" on public.manual_recurring_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "manual_recurring_items_update_own" on public.manual_recurring_items
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "manual_recurring_items_delete_own" on public.manual_recurring_items
  for delete to authenticated using (user_id = (select auth.uid()));
