-- 0022_push_reminder_log — one row per reminder actually delivered, so a scheduled
-- reminder can run several times a day without nagging the same person twice.
--
-- Why: the check-out reminder fires "after the end of YOUR working day", and working days
-- end at different times (per-employee/department schedules). The cron therefore runs on
-- a short interval through the afternoon and evening; without a record of who has already
-- been told, every run would push again to everyone still checked in.
--
-- The primary key is the guard: claiming (employee, date, kind) is an INSERT that either
-- wins or conflicts, so two overlapping runs cannot both send.
CREATE TABLE IF NOT EXISTS push_reminder_log (
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('checkin', 'checkout')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, date, kind)
);
