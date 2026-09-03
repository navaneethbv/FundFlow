-- The settings UI and rules engine support guarded regular-expression rules.
-- Keep the persisted contract aligned with those application types.

alter table public.merchant_rules
  drop constraint if exists merchant_rules_match_type_check;

alter table public.merchant_rules
  add constraint merchant_rules_match_type_check
  check (match_type in ('merchant', 'keyword', 'account', 'regex'));
