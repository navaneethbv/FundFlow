-- Migration: 20260814100000_performance_composite_indexes.sql
-- Description: Composite performance indexes for transactions, audit logs, notifications, and net worth snapshots.

-- Speed up transaction ledger pagination, date filtering, and month-scoped scans
create index if not exists idx_transactions_user_date on public.transactions (user_id, date desc, id desc);
create index if not exists idx_transactions_user_pfc_primary on public.transactions (user_id, pfc_primary);
create index if not exists idx_transactions_user_account_date on public.transactions (user_id, account_id, date desc);

-- Speed up security audit log queries
create index if not exists idx_audit_logs_user_created on public.audit_logs (user_id, created_at desc);

-- Speed up unread notifications lookup on dashboard / topbar
create index if not exists idx_notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;

-- Speed up historical net worth calculations
create index if not exists idx_net_worth_snapshots_user_month on public.net_worth_snapshots (user_id, snapshot_month desc);
