-- Holdings upsert needs a conflict target Postgres can actually infer. The
-- investments migration (20260730210000_investments.sql) only created a
-- *partial* unique index on (account_id, security_id) where source = 'plaid';
-- PostgreSQL cannot infer a partial index without its predicate, so the
-- `onConflict: "account_id,security_id"` upsert in lib/investment-sync.ts
-- failed on every holdings sync. A full unique index on
-- (account_id, security_id, source) matches the upsert's three-column target.
--
-- Safety: the table's check constraint already guarantees account_id is set
-- for source = 'plaid' and null for source = 'manual', so plaid rows never
-- collide with manual rows (which the separate partial manual index dedupes).

create unique index if not exists holdings_account_security_source_uidx
  on public.holdings (account_id, security_id, source);
