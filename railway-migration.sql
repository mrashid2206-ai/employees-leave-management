-- ============================================
-- FULL DATABASE MIGRATION FOR RAILWAY
-- Run this once in Railway PostgreSQL Query tab
-- ============================================

-- 1. Settings table
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
  work_start_time TIME NOT NULL DEFAULT '08:00',
  work_days VARCHAR(20) NOT NULL DEFAULT '0,1,2,3,4'
);

-- 2. Departments table
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Employees table
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  department_id INT NOT NULL REFERENCES departments(id),
  leave_balance INT NOT NULL DEFAULT 30,
  is_active BOOLEAN DEFAULT TRUE,
  username VARCHAR(100) UNIQUE,
  password_hash VARCHAR(255) DEFAULT '$2a$10$defaulthash',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Leave types table
CREATE TABLE IF NOT EXISTS leave_types (
  id SERIAL PRIMARY KEY,
  name_ar VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL
);

-- 5. Leave requests table
CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  leave_type_id INT NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INT NOT NULL,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT check_dates CHECK (end_date >= start_date),
  CONSTRAINT check_days_count CHECK (days_count > 0)
);

-- 6. Tardiness log table
CREATE TABLE IF NOT EXISTS tardiness_log (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  date DATE NOT NULL,
  time TIME NOT NULL,
  minutes_late INT NOT NULL,
  hours_late_decimal DECIMAL(10,5) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT check_minutes_late CHECK (minutes_late > 0)
);

-- 7. Holidays table
CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Attendance table
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  date DATE NOT NULL,
  check_in TIME,
  check_out TIME,
  work_hours DECIMAL(4,2) DEFAULT 0,
  overtime_hours DECIMAL(4,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'present',
  is_holiday_work BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date),
  CONSTRAINT check_work_hours CHECK (work_hours >= 0)
);

-- 9. Indexes
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_tardiness_employee ON tardiness_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_tardiness_date ON tardiness_log(date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id);

-- 10. Leave overlap prevention trigger
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

-- ============================================
-- SEED DATA
-- ============================================

-- Settings
INSERT INTO settings (year_start, year_end, annual_leave_balance, deduction_per_hour, currency, currency_symbol, work_hours_per_day, max_absent_same_dept, work_start_time, work_days)
VALUES ('2026-03-01', '2027-02-28', 30, 0, 'OMR', 'ر.ع.', 8, 2, '08:00', '0,1,2,3,4')
ON CONFLICT DO NOTHING;

-- Departments
INSERT INTO departments (name) VALUES ('L3'), ('L2')
ON CONFLICT DO NOTHING;

-- Leave Types
INSERT INTO leave_types (name_ar, name_en, color) VALUES
('سنوية', 'Annual', '#4CAF50'),
('مرضية', 'Sick', '#FF9800'),
('طارئة', 'Emergency', '#F44336'),
('بدون راتب', 'Unpaid', '#9E9E9E'),
('أخرى', 'Other', '#607D8B')
ON CONFLICT DO NOTHING;

-- Employees (password: 123456 hashed with bcrypt)
-- You MUST update the hash below after first deploy by running the password hash script
INSERT INTO employees (name, department_id, leave_balance, username, password_hash) VALUES
('Ankit Shrivastava', 1, 30, 'ankit.shrivastava', '$2a$10$placeholder'),
('Bahaa Haq', 1, 30, 'bahaa.haq', '$2a$10$placeholder'),
('Mohammad Al-Khader', 1, 30, 'mohammad.al-khader', '$2a$10$placeholder'),
('Kanchetty Salla', 1, 30, 'kanchetty.salla', '$2a$10$placeholder'),
('Surendra Sharma', 1, 30, 'surendra.sharma', '$2a$10$placeholder'),
('Karuneshwar Pandey', 1, 30, 'karuneshwar.pandey', '$2a$10$placeholder'),
('Prabakaran Ramu', 1, 30, 'prabakaran.ramu', '$2a$10$placeholder'),
('Mahdi AbdelNabi', 1, 30, 'mahdi.abdelnabi', '$2a$10$placeholder'),
('Ahmad AlGhoul', 1, 30, 'ahmad.alghoul', '$2a$10$placeholder'),
('Mohammed Al-Sadairi', 1, 30, 'mohammed.al-sadairi', '$2a$10$placeholder'),
('Khalid Al-Zeidi', 2, 30, 'khalid.al-zeidi', '$2a$10$placeholder'),
('Juma Said Khamis Al-Amri', 2, 30, 'juma.said.khamis.al-amri', '$2a$10$placeholder'),
('Humaid Al-Hasani', 2, 30, 'humaid.al-hasani', '$2a$10$placeholder'),
('Abhinav Harsh', 2, 30, 'abhinav.harsh', '$2a$10$placeholder')
ON CONFLICT DO NOTHING;

-- Holidays (Oman 2026-2027)
INSERT INTO holidays (name, date) VALUES
('عيد الأضحى - 1', '2026-06-07'),
('عيد الأضحى - 2', '2026-06-08'),
('عيد الأضحى - 3', '2026-06-09'),
('رأس السنة الهجرية', '2026-06-27'),
('يوم النهضة', '2026-07-23'),
('المولد النبوي', '2026-09-05'),
('العيد الوطني', '2026-11-18'),
('رأس السنة الميلادية', '2027-01-01'),
('الإسراء والمعراج', '2027-01-16'),
('عيد الفطر - 1', '2027-01-30'),
('عيد الفطر - 2', '2027-01-31'),
('عيد الفطر - 3', '2027-02-01')
ON CONFLICT DO NOTHING;

-- Leave requests (sample data)
INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status) VALUES
(1, 1, '2026-03-05', '2026-03-22', 18, NULL, 'approved'),
(7, 1, '2026-03-12', '2026-03-22', 11, NULL, 'approved'),
(9, 2, '2026-03-15', '2026-03-15', 1, NULL, 'approved'),
(10, 1, '2026-03-13', '2026-03-13', 1, NULL, 'approved'),
(11, 5, '2026-03-15', '2026-03-15', 1, NULL, 'approved')
ON CONFLICT DO NOTHING;

-- Tardiness log (sample data)
INSERT INTO tardiness_log (employee_id, date, time, minutes_late, hours_late_decimal, notes) VALUES
(2, '2026-03-15', '08:15:00', 15, 0.01042, NULL),
(3, '2026-03-15', '08:15:00', 15, 0.01042, NULL),
(9, '2026-03-28', '08:20:00', 20, 0.01389, NULL),
(2, '2026-03-30', '08:05:00', 5, 0.00347, NULL),
(7, '2026-03-30', '08:05:00', 5, 0.00347, NULL),
(6, '2026-03-30', '08:10:00', 10, 0.00694, NULL),
(5, '2026-03-30', '08:10:00', 10, 0.00694, NULL),
(4, '2026-03-30', '08:10:00', 10, 0.00694, NULL),
(8, '2026-03-30', '08:15:00', 15, 0.01042, NULL),
(1, '2026-03-30', '08:20:00', 20, 0.01389, NULL),
(7, '2026-04-02', '08:05:00', 5, 0.00347, NULL),
(9, '2026-04-02', '08:15:00', 15, 0.01042, NULL),
(4, '2026-04-02', '08:15:00', 15, 0.01042, NULL),
(5, '2026-04-02', '08:15:00', 15, 0.01042, NULL),
(6, '2026-04-02', '08:15:00', 15, 0.01042, NULL)
ON CONFLICT DO NOTHING;
