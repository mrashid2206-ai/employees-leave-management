-- 0004_permission_hours — optionally subtract approved permission (temporary exit) time
-- from the day's work hours. Default FALSE so existing behaviour is unchanged until the
-- admin opts in from Settings.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS deduct_permission_hours BOOLEAN DEFAULT FALSE;
