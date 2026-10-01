-- Preserve policy dependencies (Postgres tracks function OIDs) while removing
-- this arbitrary-user membership lookup from the exposed public RPC schema.
alter function public.is_household_member_for(uuid, uuid) set schema private;
