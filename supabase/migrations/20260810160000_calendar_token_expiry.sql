-- L10: iCal capability tokens had no lifetime — a harvested token could read
-- the feed forever. Give every token a bounded expiry. New tokens are minted
-- with an explicit expires_at by the route; the column default keeps any other
-- writer bounded too.
alter table public.calendar_tokens
  add column expires_at timestamptz not null default (now() + interval '180 days');

-- Feed lookups filter on expires_at; an index keeps the token lookup cheap.
create index calendar_tokens_expires_at_idx on public.calendar_tokens (expires_at);
