-- Smart rules auto-tagging support (features.md / PR #149)
-- Enable rules to persist tags for transaction annotation and categorization.

alter table public.merchant_rules
  add column if not exists tags text[] not null default '{}';
