-- Retirement stops projected savings and therefore carries no independent
-- cash amount. Align the database with the application model while keeping
-- every other event amount strictly positive.

update public.life_events
set amount = 0
where event_type = 'retirement'
  and amount <> 0;

alter table public.life_events
  drop constraint if exists life_events_amount_check;

alter table public.life_events
  add constraint life_events_amount_check check (
    (event_type = 'retirement' and amount = 0)
    or (event_type <> 'retirement' and amount > 0)
  );
