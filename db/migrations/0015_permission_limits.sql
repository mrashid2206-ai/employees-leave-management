-- 0015_permission_limits — put a bound on mid-day permissions.
--
-- Permissions (leaving the office mid-day and coming back) had no limit of any kind: no
-- cap on how many an employee could take, and no maximum duration. Tardiness of a few
-- minutes costs annual leave, while an unlimited number of two-hour absences cost nothing
-- — the same behaviour treated two very different ways.
--
-- Configurable rather than hardcoded, because the right number is a company decision.
-- 0 means unlimited, which preserves today's behaviour for anyone who wants it.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS max_permissions_per_month INT NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS max_permission_minutes INT NOT NULL DEFAULT 120;
