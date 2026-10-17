-- 0018_list_indexes — indexes for the sorts and date filters the list endpoints use.
--
-- Why: GET /api/leaves, /api/tardiness, /api/permissions and /api/corrections returned
-- whole tables, sorted, on every page load. They now take ?from=&to= so a report asks for
-- one leave year; these let Postgres answer that (and the sort) from an index instead of
-- scanning and sorting every row ever recorded.
--
-- Already covered, so not repeated here:
--   leave_requests(start_date)       idx_leave_requests_dates (start_date, end_date) leads with it
--   attendance(date)                 idx_attendance_date
--   tardiness_log(date)              idx_tardiness_date — kept; the composite below serves the sort

-- Admin leave list: ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS idx_leave_requests_created_at ON leave_requests (created_at DESC);

-- Permissions: filtered by date (?date=, ?from=&to=) across all employees, which
-- idx_permissions_emp_date (employee_id, date) can't serve; listed by created_at DESC.
CREATE INDEX IF NOT EXISTS idx_permissions_date ON permissions (date);
CREATE INDEX IF NOT EXISTS idx_permissions_created_at ON permissions (created_at DESC);

-- Tardiness list: ORDER BY date DESC, id DESC, and the date range in front of it.
CREATE INDEX IF NOT EXISTS idx_tardiness_date_id ON tardiness_log (date DESC, id DESC);

-- Corrections: filtered by date across all employees (idx_corrections_emp_date leads with
-- employee_id).
CREATE INDEX IF NOT EXISTS idx_corrections_date ON attendance_corrections (date);
