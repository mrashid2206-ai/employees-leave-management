import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import bcrypt from 'bcryptjs'

// One-time migration endpoint: creates tables + seeds data + hashes passwords
// Visit /api/migrate once after deployment, then delete this file
export async function GET() {
  const results: string[] = []

  try {
    // Step 1: Create tables
    await pool.query(`
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
      )
    `)
    results.push('✓ settings table created')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    results.push('✓ departments table created')

    await pool.query(`
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
      )
    `)
    results.push('✓ employees table created')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS leave_types (
        id SERIAL PRIMARY KEY,
        name_ar VARCHAR(100) NOT NULL,
        name_en VARCHAR(100) NOT NULL,
        color VARCHAR(7) NOT NULL
      )
    `)
    results.push('✓ leave_types table created')

    await pool.query(`
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
      )
    `)
    results.push('✓ leave_requests table created')

    await pool.query(`
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
      )
    `)
    results.push('✓ tardiness_log table created')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        date DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    results.push('✓ holidays table created')

    await pool.query(`
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
      )
    `)
    results.push('✓ attendance table created')

    // Step 2: Indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
      CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
      CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_tardiness_employee ON tardiness_log(employee_id);
      CREATE INDEX IF NOT EXISTS idx_tardiness_date ON tardiness_log(date);
      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
      CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id);
    `)
    results.push('✓ indexes created')

    // Step 3: Leave overlap trigger
    await pool.query(`
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
      $$ LANGUAGE plpgsql
    `)
    await pool.query(`DROP TRIGGER IF EXISTS check_leave_overlap_trigger ON leave_requests`)
    await pool.query(`
      CREATE TRIGGER check_leave_overlap_trigger
        BEFORE INSERT OR UPDATE ON leave_requests
        FOR EACH ROW
        WHEN (NEW.status = 'approved')
        EXECUTE FUNCTION check_leave_overlap()
    `)
    results.push('✓ leave overlap trigger created')

    // Step 4: Seed data
    await pool.query(`
      INSERT INTO settings (year_start, year_end, annual_leave_balance, deduction_per_hour, currency, currency_symbol, work_hours_per_day, max_absent_same_dept, work_start_time, work_days)
      VALUES ('2026-03-01', '2027-02-28', 30, 0, 'OMR', 'ر.ع.', 8, 2, '08:00', '0,1,2,3,4')
      ON CONFLICT DO NOTHING
    `)
    results.push('✓ settings seeded')

    await pool.query(`INSERT INTO departments (name) VALUES ('L3'), ('L2') ON CONFLICT DO NOTHING`)
    results.push('✓ departments seeded')

    await pool.query(`
      INSERT INTO leave_types (name_ar, name_en, color) VALUES
      ('سنوية', 'Annual', '#4CAF50'),
      ('مرضية', 'Sick', '#FF9800'),
      ('طارئة', 'Emergency', '#F44336'),
      ('بدون راتب', 'Unpaid', '#9E9E9E'),
      ('أخرى', 'Other', '#607D8B')
      ON CONFLICT DO NOTHING
    `)
    results.push('✓ leave_types seeded')

    // Hash password before inserting employees
    const hash = await bcrypt.hash('123456', 10)

    await pool.query(`
      INSERT INTO employees (name, department_id, leave_balance, username, password_hash) VALUES
      ('Ankit Shrivastava', 1, 30, 'ankit.shrivastava', $1),
      ('Bahaa Haq', 1, 30, 'bahaa.haq', $1),
      ('Mohammad Al-Khader', 1, 30, 'mohammad.al-khader', $1),
      ('Kanchetty Salla', 1, 30, 'kanchetty.salla', $1),
      ('Surendra Sharma', 1, 30, 'surendra.sharma', $1),
      ('Karuneshwar Pandey', 1, 30, 'karuneshwar.pandey', $1),
      ('Prabakaran Ramu', 1, 30, 'prabakaran.ramu', $1),
      ('Mahdi AbdelNabi', 1, 30, 'mahdi.abdelnabi', $1),
      ('Ahmad AlGhoul', 1, 30, 'ahmad.alghoul', $1),
      ('Mohammed Al-Sadairi', 1, 30, 'mohammed.al-sadairi', $1),
      ('Khalid Al-Zeidi', 2, 30, 'khalid.al-zeidi', $1),
      ('Juma Said Khamis Al-Amri', 2, 30, 'juma.said.khamis.al-amri', $1),
      ('Humaid Al-Hasani', 2, 30, 'humaid.al-hasani', $1),
      ('Abhinav Harsh', 2, 30, 'abhinav.harsh', $1)
      ON CONFLICT DO NOTHING
    `, [hash])
    results.push('✓ employees seeded (with hashed passwords)')

    await pool.query(`
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
      ON CONFLICT DO NOTHING
    `)
    results.push('✓ holidays seeded')

    await pool.query(`
      INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status) VALUES
      (1, 1, '2026-03-05', '2026-03-22', 18, NULL, 'approved'),
      (7, 1, '2026-03-12', '2026-03-22', 11, NULL, 'approved'),
      (9, 2, '2026-03-15', '2026-03-15', 1, NULL, 'approved'),
      (10, 1, '2026-03-13', '2026-03-13', 1, NULL, 'approved'),
      (11, 5, '2026-03-15', '2026-03-15', 1, NULL, 'approved')
      ON CONFLICT DO NOTHING
    `)
    results.push('✓ leave_requests seeded')

    await pool.query(`
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
      ON CONFLICT DO NOTHING
    `)
    results.push('✓ tardiness_log seeded')

    return NextResponse.json({
      success: true,
      message: 'Migration and seeding complete! Delete /api/migrate after use.',
      defaultPassword: '123456',
      steps: results
    })
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
      completedSteps: results
    }, { status: 500 })
  }
}
