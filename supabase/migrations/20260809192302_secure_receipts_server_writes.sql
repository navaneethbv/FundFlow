drop policy if exists "receipts_all_own" on public.receipts;

create policy "receipts_select_own" on public.receipts
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.receipts from authenticated;
grant select on public.receipts to authenticated;

drop policy if exists "receipt_objects_all_own" on storage.objects;
