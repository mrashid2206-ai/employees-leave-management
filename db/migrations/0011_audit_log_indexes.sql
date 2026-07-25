-- 0011_audit_log_indexes — support filtering and paging the audit log.
--
-- The audit page used to fetch a flat `LIMIT 100` and filter in the browser. It now
-- filters and pages in SQL over the whole table, which needs the log to be cheap to
-- order by time and to narrow by action. audit_log only grows, so these matter more
-- every month the system runs.
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action);
