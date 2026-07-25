-- 0008_per_entity_schedules — work schedules per department (and optionally per
-- employee) instead of one global schedule for everyone.
--
-- Why this matters: tardiness is measured against work_start_time and now COSTS annual
-- leave. With a single global start time, anyone working different hours is marked late
-- (and charged) incorrectly. All columns are NULL by default and fall back
-- employee -> department -> global settings, so behaviour is unchanged until set.
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS work_start_time TIME,
  ADD COLUMN IF NOT EXISTS work_days VARCHAR(20),
  ADD COLUMN IF NOT EXISTS work_hours_per_day INT;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS work_start_time TIME,
  ADD COLUMN IF NOT EXISTS work_days VARCHAR(20),
  ADD COLUMN IF NOT EXISTS work_hours_per_day INT;
