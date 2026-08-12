-- ---------------------------------------------------------------------------
-- 20260812110000_visible_institutions_rpc: household-safe institution metadata.
--
-- plaid_items stores encrypted access-token material, so its RLS policy keeps
-- it owner-only. The /accounts page renders household-shared accounts too, and
-- its institution name/logo/brand-color lookup queries plaid_items scoped to
-- the current user — so a member's shared accounts silently lost institution
-- metadata and vanished from the institution filter.
--
-- This RPC returns institution metadata for exactly the items the caller may
-- see: their own, plus any item backing an account they can read through a
-- shared household (the same `private.can_read_shared_account` decision the
-- accounts RLS policies use). It runs SECURITY DEFINER so the plaid_items read
-- is the caller's decision, not their RLS visibility.
-- ---------------------------------------------------------------------------
create or replace function public.visible_institutions()
returns table (
  id uuid,
  institution_name text,
  institution_logo text,
  institution_brand_color text
)
language sql
security definer
set search_path = ''
stable
as $$
  select distinct
    pi.id,
    pi.institution_name,
    pi.institution_logo,
    pi.institution_brand_color
  from public.plaid_items pi
  where pi.user_id = (select auth.uid())
    or exists (
      select 1
      from public.accounts a
      where a.plaid_item_id = pi.id
        and private.can_read_shared_account(a.id)
    );
$$;

revoke all on function public.visible_institutions() from public, anon;
grant execute on function public.visible_institutions() to authenticated, service_role;
