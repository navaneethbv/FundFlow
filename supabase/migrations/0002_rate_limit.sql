-- Lightweight fixed-window rate limiting, backed by Postgres so it works across
-- serverless invocations. No RLS policies => only the secret key can touch it.

create table public.rate_limit_counters (
  key           text primary key,
  count         int not null default 0,
  window_start  timestamptz not null default now()
);

alter table public.rate_limit_counters enable row level security;

-- Atomically record a hit for `p_key` in a fixed window. Returns true if the
-- request is within the limit, false if it should be rejected.
create or replace function public.rate_limit_hit(
  p_key text,
  p_max int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.rate_limit_counters (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set count = case
          when public.rate_limit_counters.window_start
               < now() - make_interval(secs => p_window_seconds)
          then 1
          else public.rate_limit_counters.count + 1
        end,
        window_start = case
          when public.rate_limit_counters.window_start
               < now() - make_interval(secs => p_window_seconds)
          then now()
          else public.rate_limit_counters.window_start
        end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;
