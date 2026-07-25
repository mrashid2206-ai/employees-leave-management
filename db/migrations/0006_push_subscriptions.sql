-- 0006_push_subscriptions — Web Push endpoints per employee/device, so the portal can
-- send "you haven't checked in" reminders and other alerts even when it isn't open.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_employee ON push_subscriptions(employee_id);
