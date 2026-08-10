-- Periodic Plaid access-token rotation (M2): the app encrypts access tokens at
-- rest but never rotates the token itself, so a token that leaks (app-side
-- ciphertext with the key, a Plaid-side breach, a sticky debugger) stays valid
-- indefinitely. Rotation calls /item/access_token/invalidate, which returns a
-- fresh token and immediately invalidates the old one.
--
-- The timestamp lets the daily sync rotate each item's token on a cadence
-- (TOKEN_ROTATION_DAYS in lib/plaid-service.ts). Only the app writes it.

alter table public.plaid_items
  add column if not exists access_token_rotated_at timestamptz;
