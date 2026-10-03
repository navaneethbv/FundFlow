-- Additive user-authored preferences; existing MFA/revocation policies apply.
alter table public.alert_preferences
  add column new_merchant boolean not null default false,
  add column double_charge boolean not null default false,
  add column category_spike boolean not null default false,
  add column merchant_spike boolean not null default false,
  add column bill_overdue boolean not null default false,
  add column savings_rate_change boolean not null default false,
  add column idle_cash boolean not null default false,
  add column goal_reserve_depleted boolean not null default false;
