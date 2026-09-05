-- SMTP delivery cannot be rolled back with the journal write.
-- Record the boundary before sending, so a failed completion write or an
-- ambiguous SMTP response cannot cause an automatic duplicate delivery.
alter table public.backup_deliveries
  add column if not exists send_started_at timestamptz;

-- Existing unfinished claims may already have sent mail under the earlier
-- protocol. Preserve that uncertainty instead of automatically resending.
update public.backup_deliveries
   set send_started_at = claimed_at
 where delivered_at is null and send_started_at is null;
