-- 0017_decision_details — record who decided a request, when, and why.
--
-- Leave requests, permissions and attendance corrections are all approved or rejected by
-- an admin, but each kept a different (and incomplete) trace of that decision: corrections
-- stored the reviewer and time, permissions only the reviewer (approved_by), and leave
-- requests nothing at all. None stored a reason, so an employee whose request was refused
-- had no way to learn why, and an admin looking back had no way to tell who refused it.
--
-- permissions.approved_by keeps its name (it is already the reviewer for both outcomes)
-- rather than being renamed to reviewed_by, so nothing that reads it has to change.
--
-- Existing rows are not backfilled: the time of past decisions was never recorded, and a
-- guessed value (created_at, updated_at) would read as fact on the screen.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_note TEXT;

ALTER TABLE permissions
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_note TEXT;

ALTER TABLE attendance_corrections
  ADD COLUMN IF NOT EXISTS decision_note TEXT;

-- The note is shown to the employee in the portal and sent in a push notification; the
-- API caps it at 500 characters, and the database holds the same line.
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_decision_note_len;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_decision_note_len CHECK (char_length(decision_note) <= 500);

ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_decision_note_len;
ALTER TABLE permissions
  ADD CONSTRAINT permissions_decision_note_len CHECK (char_length(decision_note) <= 500);

ALTER TABLE attendance_corrections DROP CONSTRAINT IF EXISTS corrections_decision_note_len;
ALTER TABLE attendance_corrections
  ADD CONSTRAINT corrections_decision_note_len CHECK (char_length(decision_note) <= 500);
