-- Isolated database only. Synthetic fixtures are rolled back.
begin;
insert into auth.users(id, email) values
 ('61000000-0000-0000-0000-000000000001', 'move-owner@example.invalid'),
 ('61000000-0000-0000-0000-000000000002', 'move-other@example.invalid');
insert into public.budgets(id, user_id, category, monthly_limit) values
 ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'FOOD_AND_DRINK', 400),
 ('62000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001', 'TRAVEL', 100),
 ('62000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000002', 'TRAVEL', 100);
-- The source month already has its own planned amount; the target does not.
insert into public.budget_periods(user_id, budget_id, month, planned) values
 ('61000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001', '2026-10-01', 350);

select public.move_budget_amount('61000000-0000-0000-0000-000000000001', '2026-10-01',
  '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', 50.25);

do $$ begin
 assert (select planned from public.budget_periods where budget_id='62000000-0000-0000-0000-000000000001' and month='2026-10-01')=299.75, 'Source period not reduced';
 assert (select planned from public.budget_periods where budget_id='62000000-0000-0000-0000-000000000002' and month='2026-10-01')=150.25, 'Target did not start from its monthly limit';
 assert (select monthly_limit from public.budgets where id='62000000-0000-0000-0000-000000000002')=100, 'Move changed the default limit';
 assert (select count(*) from public.budget_moves where user_id='61000000-0000-0000-0000-000000000001' and amount=50.25)=1, 'Move history missing';

 -- Overdrawing the source refuses the whole move.
 begin
  perform public.move_budget_amount('61000000-0000-0000-0000-000000000001', '2026-10-01',
    '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', 300);
  raise exception 'Overdraw succeeded';
 exception when sqlstate '22023' then null;
 end;
 assert (select planned from public.budget_periods where budget_id='62000000-0000-0000-0000-000000000002' and month='2026-10-01')=150.25, 'Refused move changed the target';

 -- Another owner's budget is never reachable.
 begin
  perform public.move_budget_amount('61000000-0000-0000-0000-000000000001', '2026-10-01',
    '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000003', 10);
  raise exception 'Cross-owner move succeeded';
 exception when sqlstate 'P0002' then null;
 end;

 -- Malformed input is rejected before any lock or write.
 begin
  perform public.move_budget_amount('61000000-0000-0000-0000-000000000001', '2026-10-15',
    '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', 10);
  raise exception 'Mid-month move succeeded';
 exception when sqlstate '22023' then null;
 end;
 begin
  perform public.move_budget_amount('61000000-0000-0000-0000-000000000001', '2026-10-01',
    '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', 0.001);
  raise exception 'Sub-cent move succeeded';
 exception when sqlstate '22023' then null;
 end;

 assert not has_function_privilege('authenticated', 'public.move_budget_amount(uuid,date,uuid,uuid,numeric)', 'EXECUTE'), 'Clients may move budget money directly';
 assert not has_table_privilege('authenticated', 'public.budget_moves', 'INSERT'), 'Clients may forge move history';
 assert has_table_privilege('authenticated', 'public.budget_moves', 'SELECT'), 'Owners cannot read move history';
end $$;
rollback;
