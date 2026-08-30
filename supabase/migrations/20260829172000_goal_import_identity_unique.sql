-- Enforce one imported goal identity per owner and source.
-- Null import identities remain valid for native goals.

-- Preserve any pre-constraint duplicates as ordinary FundFlow goals while the
-- most recently updated row retains the provider identity used for re-import.
with ranked_identities as (
  select
    id,
    row_number() over (
      partition by user_id, import_source, import_ref
      order by updated_at desc, id desc
    ) as identity_rank
  from public.goals
  where import_source is not null
    and import_ref is not null
)
update public.goals
set import_source = null,
    import_ref = null
where id in (
  select id
  from ranked_identities
  where identity_rank > 1
);

create unique index if not exists goals_import_identity_unique_idx
  on public.goals (user_id, import_source, import_ref)
  where import_source is not null
    and import_ref is not null;
