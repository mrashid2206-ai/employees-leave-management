-- Seed data
-- Settings
INSERT INTO settings (year_start, year_end, annual_leave_balance, deduction_per_hour, currency, currency_symbol, work_hours_per_day, max_absent_same_dept)
VALUES ('2026-03-01', '2027-02-28', 30, 0, 'OMR', 'ر.ع.', 8, 2)
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

-- Employees (10 in L3, 4 in L2)
INSERT INTO employees (name, department_id, leave_balance) VALUES
('Ankit Shrivastava', 1, 30),
('Bahaa Haq', 1, 30),
('Mohammad Al-Khader', 1, 30),
('Kanchetty Salla', 1, 30),
('Surendra Sharma', 1, 30),
('Karuneshwar Pandey', 1, 30),
('Prabakaran Ramu', 1, 30),
('Mahdi AbdelNabi', 1, 30),
('Ahmad AlGhoul', 1, 30),
('Mohammed Al-Sadairi', 1, 30),
('Khalid Al-Zeidi', 2, 30),
('Juma Said Khamis Al-Amri', 2, 30),
('Humaid Al-Hasani', 2, 30),
('Abhinav Harsh', 2, 30)
ON CONFLICT DO NOTHING;

-- Leave requests
INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status) VALUES
(1, 1, '2026-03-05', '2026-03-22', 18, NULL, 'approved'),
(7, 1, '2026-03-12', '2026-03-22', 11, NULL, 'approved'),
(9, 2, '2026-03-15', '2026-03-15', 1, NULL, 'approved'),
(10, 1, '2026-03-13', '2026-03-13', 1, NULL, 'approved'),
(11, 5, '2026-03-15', '2026-03-15', 1, NULL, 'approved');

-- Tardiness log (minutes_late stored, hours_late_decimal = minutes/1440)
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
(6, '2026-04-02', '08:15:00', 15, 0.01042, NULL);
