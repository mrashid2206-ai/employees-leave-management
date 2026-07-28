-- 0014_status_constraints — make the status columns mean something at the database level.
--
-- Both were plain VARCHAR with no constraint, so 'banana' stored happily. That matters
-- beyond tidiness: all the balance accounting keys off these exact strings, so a value
-- outside the known set silently bypasses every deduction and refund rule — the row is
-- simply invisible to `status = 'approved'` filters.
--
-- Verified against production before adding: leave_requests holds only approved /
-- cancelled / rejected, attendance only present / absent / holiday. 'pending' and 'leave'
-- are included because the application creates them.

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance
  ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present', 'absent', 'leave', 'holiday'));

-- Days must be positive. A negative or zero days_count would corrupt a balance in the
-- direction of giving days away, and nothing prevented one being written.
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_days_positive;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_days_positive CHECK (days_count > 0);

-- A leave cannot end before it starts.
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_date_order;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_date_order CHECK (end_date >= start_date);

-- Lateness is never negative; a negative value would credit leave back via the
-- tardiness penalty rather than charge it.
ALTER TABLE tardiness_log DROP CONSTRAINT IF EXISTS tardiness_minutes_non_negative;
ALTER TABLE tardiness_log
  ADD CONSTRAINT tardiness_minutes_non_negative CHECK (minutes_late >= 0);
