-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  year_start DATE NOT NULL DEFAULT '2026-03-01',
  year_end DATE NOT NULL DEFAULT '2027-02-28',
  annual_leave_balance INT NOT NULL DEFAULT 30,
  deduction_per_hour DECIMAL(10,3) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'OMR',
  currency_symbol VARCHAR(10) NOT NULL DEFAULT 'ر.ع.',
  work_hours_per_day INT NOT NULL DEFAULT 8,
  max_absent_same_dept INT NOT NULL DEFAULT 2
);

-- Departments table
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  department_id INT NOT NULL REFERENCES departments(id),
  leave_balance INT NOT NULL DEFAULT 30,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leave types table
CREATE TABLE IF NOT EXISTS leave_types (
  id SERIAL PRIMARY KEY,
  name_ar VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL
);

-- Leave requests table
CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  leave_type_id INT NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INT NOT NULL,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'approved',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tardiness log table
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

-- Enable RLS but allow all for now (no auth)
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tardiness_log ENABLE ROW LEVEL SECURITY;

-- Policies allowing all access (admin-only app)
CREATE POLICY "Allow all on settings" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on departments" ON departments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on employees" ON employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on leave_types" ON leave_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on leave_requests" ON leave_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on tardiness_log" ON tardiness_log FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_employees_department ON employees(department_id);
CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX idx_tardiness_employee ON tardiness_log(employee_id);
CREATE INDEX idx_tardiness_date ON tardiness_log(date);
