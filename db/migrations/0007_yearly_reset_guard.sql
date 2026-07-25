-- 0007_yearly_reset_guard — record WHEN the yearly reset last ran.
-- last_reset_year alone can't stop a double-advance: the reset moves the fiscal year
-- forward, so an immediate second run computes a *different* fromYear and slips past the
-- guard. A same-day check closes that hole (double-click / retry / duplicate trigger).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ;
