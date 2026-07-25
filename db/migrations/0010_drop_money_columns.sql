-- 0010_drop_money_columns — remove the last traces of payroll from the schema.
--
-- This system tracks attendance, tardiness and leave. It has no payroll and never
-- deducts money from an employee; tardiness is now paid for in annual leave instead
-- (see tardiness-penalty.ts). These columns were left behind when the money features
-- were removed: nothing reads them, no UI shows them, and keeping them invites someone
-- to wire salary deductions back in.
ALTER TABLE settings
  DROP COLUMN IF EXISTS deduction_per_hour,
  DROP COLUMN IF EXISTS currency,
  DROP COLUMN IF EXISTS currency_symbol;

-- Redundant rather than money-related: it is always minutes_late / 60, so it is a
-- second copy of the same fact that can silently disagree with it.
ALTER TABLE tardiness_log
  DROP COLUMN IF EXISTS hours_late_decimal;
