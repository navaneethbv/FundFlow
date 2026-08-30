-- Ownership hardening for transaction_annotations (the M8 pattern).
--
-- The original policies checked only the child row's user_id. Because
-- transactions is also readable for a household member's opted-in shared
-- connections, that let a member (or any authenticated caller who could see
-- the transaction id) attach note/tags/override rows to someone else's
-- transaction. The write policies now also require the referenced transaction
-- to be owned by the writer; the select policy is unchanged (annotations are
-- only ever read for the caller's own rows by the app).

drop policy if exists "transaction_annotations_insert_own"
  on public.transaction_annotations;
drop policy if exists "transaction_annotations_update_own"
  on public.transaction_annotations;
drop policy if exists "transaction_annotations_delete_own"
  on public.transaction_annotations;

create policy "transaction_annotations_insert_own" on public.transaction_annotations
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
  );

create policy "transaction_annotations_update_own" on public.transaction_annotations
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
  );

create policy "transaction_annotations_delete_own" on public.transaction_annotations
  for delete to authenticated using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_annotations.transaction_id
        and t.user_id = (select auth.uid())
    )
  );