-- Enforce one imported goal identity per owner and source.
-- Null import identities remain valid for native goals.

create unique index if not exists goals_import_identity_unique_idx
  on public.goals (user_id, import_source, import_ref)
  where import_source is not null
    and import_ref is not null;
