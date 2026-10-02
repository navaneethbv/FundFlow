-- User-maintained membership and card terms stay in the existing profile
-- preference row so no provider data or new client-writable table is needed.
alter table public.profiles
  add column if not exists card_value_terms jsonb not null default '[]'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_card_value_terms_array;
alter table public.profiles
  add constraint profiles_card_value_terms_array
  check (jsonb_typeof(card_value_terms) = 'array');
