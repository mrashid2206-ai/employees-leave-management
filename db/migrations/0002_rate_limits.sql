-- 0002_rate_limits — persistent, cross-instance login rate limiting.
-- Replaces the in-process Map that reset on every deploy and diverged across instances.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);
