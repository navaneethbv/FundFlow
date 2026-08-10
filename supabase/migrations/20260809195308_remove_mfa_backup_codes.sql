drop policy if exists "mfa_backup_codes_select_own" on public.mfa_backup_codes;
drop policy if exists "mfa_backup_codes_insert_own" on public.mfa_backup_codes;
drop policy if exists "mfa_backup_codes_update_own" on public.mfa_backup_codes;
drop policy if exists "mfa_backup_codes_delete_own" on public.mfa_backup_codes;
drop index if exists public.mfa_backup_codes_user_idx;
revoke all on table public.mfa_backup_codes from anon, authenticated;
drop table if exists public.mfa_backup_codes;
