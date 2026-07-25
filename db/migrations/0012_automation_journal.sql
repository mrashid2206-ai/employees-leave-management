-- 0012_automation_journal — record what each automation run changed, so a bad run can be
-- undone with a button instead of hand-written SQL.
--
-- Motivation, from a real incident: a daily run processed an in-progress day and marked
-- all 14 employees absent, deducting a leave day from each. The bug was fixed, but the
-- cleanup was a bespoke UPDATE written under pressure against production. The automation
-- mutates leave balances on a schedule, so "it did the wrong thing" is a permanent
-- category of risk, not a one-off.
--
-- Every mutation is journalled with enough state to reverse it exactly: which row, and
-- what it looked like before.

CREATE TABLE IF NOT EXISTS automation_runs (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(20) NOT NULL,           -- 'daily' | 'yearly'
  target_date DATE,                    -- the day processed (NULL for a yearly reset)
  actor VARCHAR(100),
  actor_role VARCHAR(20),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  reversed_by VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS automation_effects (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  -- 'absence_marked' | 'absence_leave' | 'tardiness_created' | 'auto_checkout'
  -- | 'permission_closed' | 'yearly_balance' | 'yearly_settings'
  kind VARCHAR(40) NOT NULL,
  employee_id INT,
  -- Whatever reversing this specific change requires (row id + prior values).
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_effects_run ON automation_effects (run_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_created ON automation_runs (created_at DESC);

-- Error journal (see src/lib/error-log.ts). Server errors were only ever written to
-- stdout, so a 500 in production was invisible unless someone happened to be reading
-- Railway logs at the time.
CREATE TABLE IF NOT EXISTS error_log (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  stack TEXT,
  digest VARCHAR(100),
  path TEXT,
  method VARCHAR(10),
  source VARCHAR(40),                  -- 'server' | 'client' | route type from Next
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log (created_at DESC);
