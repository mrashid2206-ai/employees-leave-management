-- 0001_baseline — canonical, fully idempotent schema for the employees app.
-- Safe to apply to a brand-new database OR an already-provisioned one (everything is
-- IF NOT EXISTS / ALTER ... TYPE, which are no-ops when already in the target state).
-- Intentionally excludes: seed data, and the UNIQUE indexes that can fail on pre-existing
-- duplicate rows (those stay as best-effort self-heal in src/lib/ensure-schema.ts; run
-- POST /api/cleanup first to dedupe, then they apply).

-- Core tables -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  year_start DATE NOT NULL DEFAULT '2026-03-01',
  year_end DATE NOT NULL DEFAULT '2027-02-28',
  annual_leave_balance INT NOT NULL DEFAULT 30,
  deduction_per_hour DECIMAL(10,3) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'OMR',
  currency_symbol VARCHAR(10) NOT NULL DEFAULT 'ر.ع.',
  work_hours_per_day INT NOT NULL DEFAULT 8,
  max_absent_same_dept INT NOT NULL DEFAULT 2,
  work_start_time TIME NOT NULL DEFAULT '07:30',
  work_days VARCHAR(20) NOT NULL DEFAULT '0,1,2,3,4'
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  department_id INT NOT NULL REFERENCES departments(id),
  leave_balance NUMERIC(5,1) NOT NULL DEFAULT 30,
  is_active BOOLEAN DEFAULT TRUE,
  username VARCHAR(100) UNIQUE,
  password_hash VARCHAR(255),
  must_change_password BOOLEAN DEFAULT FALSE,
  join_date DATE,
  email VARCHAR(200),
  phone VARCHAR(50),
  position VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_types (
  id SERIAL PRIMARY KEY,
  name_ar VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  leave_type_id INT NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count NUMERIC(5,1) NOT NULL,
  is_half_day BOOLEAN DEFAULT FALSE,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tardiness_log (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  date DATE NOT NULL,
  time TIME NOT NULL,
  minutes_late INT NOT NULL,
  hours_late_decimal DECIMAL(10,5) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- Column reconciliation for databases created before these columns existed -----------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS username VARCHAR(100),
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS join_date DATE,
  ADD COLUMN IF NOT EXISTS email VARCHAR(200),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS position VARCHAR(200);
ALTER TABLE employees ALTER COLUMN leave_balance TYPE NUMERIC(5,1);

ALTER TABLE leave_requests ALTER COLUMN days_count TYPE NUMERIC(5,1);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN DEFAULT FALSE;

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS work_start_time TIME DEFAULT '07:30',
  ADD COLUMN IF NOT EXISTS work_days VARCHAR(20) DEFAULT '0,1,2,3,4',
  ADD COLUMN IF NOT EXISTS office_lat DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS office_lng DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS office_radius INT DEFAULT 200,
  ADD COLUMN IF NOT EXISTS office_ip VARCHAR(100),
  ADD COLUMN IF NOT EXISTS block_offsite_checkin BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_reset_year INT;

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

-- Non-unique hot-path indexes (always safe) -----------------------------------------
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_emp_status ON leave_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_tardiness_employee ON tardiness_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_tardiness_date ON tardiness_log(date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_permissions_emp_date ON permissions(employee_id, date);

-- Leave-overlap prevention trigger (idempotent) -------------------------------------
CREATE OR REPLACE FUNCTION check_leave_overlap() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM leave_requests
    WHERE employee_id = NEW.employee_id
      AND id != COALESCE(NEW.id, 0)
      AND status = 'approved'
      AND start_date <= NEW.end_date
      AND end_date >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'Overlapping leave request exists';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_leave_overlap_trigger ON leave_requests;
CREATE TRIGGER check_leave_overlap_trigger
  BEFORE INSERT OR UPDATE ON leave_requests
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION check_leave_overlap();
