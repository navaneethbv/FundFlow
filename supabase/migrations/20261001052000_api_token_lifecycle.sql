-- Existing tokens receive a 90-day migration grace period.
alter table public.api_tokens add column expires_at timestamptz not null default (now() + interval '90 days');
-- Mint only through the server's fresh step-up check. Clients may revoke only.
revoke insert, update on public.api_tokens from authenticated;
grant update (revoked_at) on public.api_tokens to authenticated;

-- Credential lifecycle events can happen directly through Supabase Auth.
-- Database triggers therefore also cover password resets and global sign-out
-- performed outside this application's UI.
create function private.revoke_export_tokens_on_auth_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  if TG_TABLE_NAME = 'users' then
    if NEW.encrypted_password is not distinct from OLD.encrypted_password then return NEW; end if;
    owner_id := NEW.id;
  elsif TG_TABLE_NAME = 'sessions' then
    owner_id := OLD.user_id;
    -- A single-device logout does not revoke unrelated integrations.
    if exists (select 1 from auth.sessions where user_id = owner_id) then return OLD; end if;
  else
    owner_id := OLD.user_id;
    if OLD.status <> 'verified' then return OLD; end if;
  end if;
  update public.api_tokens set revoked_at = now() where user_id = owner_id and revoked_at is null;
  update public.calendar_tokens set revoked_at = now() where user_id = owner_id and revoked_at is null;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function private.revoke_export_tokens_on_auth_change() from public, anon, authenticated;
create trigger revoke_export_tokens_on_password_change after update of encrypted_password on auth.users
for each row execute function private.revoke_export_tokens_on_auth_change();
create trigger revoke_export_tokens_on_global_signout after delete on auth.sessions
for each row execute function private.revoke_export_tokens_on_auth_change();
create trigger revoke_export_tokens_on_mfa_reset after delete on auth.mfa_factors
for each row execute function private.revoke_export_tokens_on_auth_change();

-- Revocation is monotonic, including direct client writes to revoked_at.
create function private.prevent_token_reactivation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if OLD.revoked_at is not null and NEW.revoked_at is null then
    raise exception 'Revoked tokens cannot be reactivated';
  end if;
  return NEW;
end;
$$;
revoke all on function private.prevent_token_reactivation() from public, anon, authenticated;
create trigger api_token_no_reactivation before update on public.api_tokens
for each row execute function private.prevent_token_reactivation();
create trigger calendar_token_no_reactivation before update on public.calendar_tokens
for each row execute function private.prevent_token_reactivation();
