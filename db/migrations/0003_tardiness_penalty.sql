-- 0003_tardiness_penalty — late arrivals deduct annual leave proportionally.
-- Widen leave_balance to 3 decimals so small per-minute deductions register, and track
-- how much each tardiness row deducted so deleting it refunds exactly that amount.
ALTER TABLE employees ALTER COLUMN leave_balance TYPE NUMERIC(7,3);
ALTER TABLE tardiness_log ADD COLUMN IF NOT EXISTS leave_deducted NUMERIC(7,3) NOT NULL DEFAULT 0;
