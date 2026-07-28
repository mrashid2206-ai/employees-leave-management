export interface Settings {
  id: number
  year_start: string
  year_end: string
  annual_leave_balance: number
  work_hours_per_day: number
  max_absent_same_dept: number
  work_start_time: string
  work_days: string
  office_lat?: number
  office_lng?: number
  office_radius?: number
  office_ip?: string
  max_permissions_per_month?: number
  max_permission_minutes?: number
}

export interface Department {
  id: number
  name: string
  created_at: string
  // Optional per-department work schedule. NULL means "inherit the global setting".
  work_start_time?: string | null
  work_days?: string | null
  work_hours_per_day?: number | null
}

export interface DepartmentUpdate {
  name?: string
  work_start_time?: string | null
  work_days?: string | null
  work_hours_per_day?: number | null
}

export interface Employee {
  id: number
  name: string
  department_id: number
  leave_balance: number
  is_active: boolean
  username?: string
  join_date?: string
  email?: string
  phone?: string
  position?: string
  created_at: string
  updated_at: string
  department?: Department
  // Optional per-employee work schedule. NULL means "inherit the department's schedule",
  // which in turn falls back to the global setting. See src/lib/schedule.ts.
  work_start_time?: string | null
  work_days?: string | null
  work_hours_per_day?: number | null
}

/** The three fields that make up an overridable work schedule. */
export interface ScheduleOverride {
  work_start_time?: string | null
  work_days?: string | null
  work_hours_per_day?: number | null
}

export interface LeaveType {
  id: number
  name_ar: string
  name_en: string
  color: string
}

export interface LeaveRequest {
  id: number
  employee_id: number
  leave_type_id: number
  start_date: string
  end_date: string
  days_count: number
  notes: string | null
  status: string
  created_at: string
  updated_at: string
  employee?: Employee
  leave_type?: LeaveType
}

export interface TardinessRecord {
  id: number
  employee_id: number
  date: string
  time: string
  minutes_late: number
  leave_deducted?: number
  notes: string | null
  created_at: string
  updated_at: string
  employee?: Employee
}

export interface DashboardStats {
  activeEmployees: number
  onLeaveToday: number
  avgRemainingBalance: number
  totalTardinessMinutes: number
}

export interface EmployeeWithStats extends Employee {
  department_name: string
  used_leave: number
  remaining_balance: number
  total_tardiness_minutes: number
  total_deduction: number
  leave_by_type: Record<string, number>
  status: 'on_leave' | 'active'
}
