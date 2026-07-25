-- 0005_attendance_corrections — employees can formally request a fix to a wrong
-- attendance record instead of asking the admin verbally; admins review a queue.
CREATE TABLE IF NOT EXISTS attendance_corrections (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  date DATE NOT NULL,
  requested_check_in TIME,
  requested_check_out TIME,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corrections_status ON attendance_corrections(status);
CREATE INDEX IF NOT EXISTS idx_corrections_emp_date ON attendance_corrections(employee_id, date);
