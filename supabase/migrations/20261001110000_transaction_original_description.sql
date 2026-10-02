-- Preserve the provider descriptor separately from display/merchant names.
-- Existing rows remain null until an ordinary sync supplies this optional field.
-- No grants change; transaction owner, session and MFA policies still apply.
alter table public.transactions add column original_description text;
comment on column public.transactions.original_description is
  'Provider raw descriptor for local rules; excluded from export and AI payloads.';
