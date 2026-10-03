-- API token capabilities are explicit so an aggregate-only credential can
-- never reach a row export by accident.
alter table public.api_tokens
  add column if not exists scopes text[] not null default array['export:rows']::text[];

-- Existing credentials retain exactly their prior export permission. The
-- default also covers rows created by the original table migration.
update public.api_tokens
set scopes = array['export:rows']::text[]
where scopes is null or cardinality(scopes) = 0;

alter table public.api_tokens
  drop constraint if exists api_tokens_scopes_check;

alter table public.api_tokens
  add constraint api_tokens_scopes_check check (
    cardinality(scopes) > 0
    and scopes <@ array['export:rows', 'mcp:aggregates', 'mcp:export-rows']::text[]
  );

comment on column public.api_tokens.scopes is
  'Explicit server-checked capabilities. Existing tokens are backfilled to export:rows.';
