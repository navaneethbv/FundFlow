-- Goals config import: stable imported identifiers so re-imports match by
-- identifier, never by name alone. FundFlow contribution events and
-- allocation caps are untouched by import; these columns only record the
-- origin so a later Monarch re-import can merge into the same goal.

alter table public.goals
  add column if not exists import_source text,
  add column if not exists import_ref text;

create index if not exists goals_import_ref_idx
  on public.goals (user_id, import_source, import_ref);