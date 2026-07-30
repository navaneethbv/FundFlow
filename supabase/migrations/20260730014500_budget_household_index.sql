-- Roll forward the Phase 4 performance advisor finding after the main
-- Budget migration was applied to production.
create index if not exists budgets_household_id_idx
  on public.budgets (household_id);
