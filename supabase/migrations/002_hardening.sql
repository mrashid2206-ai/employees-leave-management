-- ============================================================================
-- 002_hardening.sql — idempotent reconciliation migration
-- Brings ANY existing database (supabase- or railway-provisioned) up to the full
-- hardened schema. Safe to run multiple times. Mirrors the runtime self-heal in
-- src/lib/ensure-schema.ts so a freshly provisioned DB matches a long-running one.
-- ============================================================================

-- Missing core tables (the original supabase 001 migration omitted these) -----------
CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  date DATE NOT NULL,
  check_in TIME,
  check_out TIME,
  work_hours DECIMAL(5,2) DEFAULT 0,
  overtime_hours DECIMAL(5,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'present',
  is_holiday_work BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(200) NOT NULL,
  role VARCHAR(20) DEFAULT 'admin',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  action VARCHAR(100) NOT NULL,
  user_id VARCHAR(100),
  user_role VARCHAR(20),
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  date DATE NOT NULL,
  leave_time TIME NOT NULL,
  return_time TIME,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  approved_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_notifications (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL,
  message TEXT NOT NULL,
  message_ar TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Employee auth + settings columns --------------------------------------------------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS username VARCHAR(100),
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS join_date DATE,
  ADD COLUMN IF NOT EXISTS email VARCHAR(200),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS position VARCHAR(200);

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS work_start_time TIME DEFAULT '07:30',
  ADD COLUMN IF NOT EXISTS work_days VARCHAR(20) DEFAULT '0,1,2,3,4',
  ADD COLUMN IF NOT EXISTS office_lat DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS office_lng DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS office_radius INT DEFAULT 200,
  ADD COLUMN IF NOT EXISTS office_ip VARCHAR(100),
  ADD COLUMN IF NOT EXISTS block_offsite_checkin BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_reset_year INT;

-- Attendance location/checkout columns ----------------------------------------------
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_in_lat DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS check_in_lng DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS check_in_ip VARCHAR(100),
  ADD COLUMN IF NOT EXISTS check_out_lat DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS check_out_lng DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS check_out_ip VARCHAR(100),
  ADD COLUMN IF NOT EXISTS is_offsite BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_offsite_checkout BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS excused_tardiness BOOLEAN DEFAULT FALSE;

-- Fractional leave support (half-day = 0.5) -----------------------------------------
ALTER TABLE leave_requests ALTER COLUMN days_count TYPE NUMERIC(5,1);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN DEFAULT FALSE;
ALTER TABLE employees ALTER COLUMN leave_balance TYPE NUMERIC(5,1);

-- Uniqueness the ON CONFLICT seeds rely on (run /api/cleanup first if these fail) ----
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_types_name_en ON leave_types(name_en);
CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_date ON holidays(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tardiness_unique ON tardiness_log(employee_id, date);

-- Hot-path indexes ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_emp_status ON leave_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_permissions_emp_date ON permissions(employee_id, date);
