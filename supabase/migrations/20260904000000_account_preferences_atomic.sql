-- Merge account visibility and ordering into dashboard_prefs in one row update.
-- The row-level update keeps sibling preferences from being lost when another
-- browser action changes the JSONB column at the same time.

create or replace function public.update_account_preferences(
  p_accounts_page jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_preferences jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_accounts_page is null or jsonb_typeof(p_accounts_page) <> 'object' then
    raise exception 'account_preferences_invalid' using errcode = '22023';
  end if;

  update public.profiles
  set dashboard_prefs = coalesce(dashboard_prefs, '{}'::jsonb)
    || jsonb_build_object('accountsPage', p_accounts_page)
  where id = auth.uid()
  returning dashboard_prefs into updated_preferences;

  if updated_preferences is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  return updated_preferences;
end;
$$;

revoke all on function public.update_account_preferences(jsonb) from public;
grant execute on function public.update_account_preferences(jsonb) to authenticated;
