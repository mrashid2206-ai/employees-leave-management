export interface Settings {
  id: number
  year_start: string
  year_end: string
  annual_leave_balance: number
  deduction_per_hour: number
  currency: string
  currency_symbol: string
  work_hours_per_day: number
  max_absent_same_dept: number
  work_start_time: string
  work_days: string
  office_lat?: number
  office_lng?: number
  office_radius?: number
  office_ip?: string
}

export interface Department {
  id: number
  name: string
  created_at: string
}

export interface Employee {
  id: number
  name: string
  department_id: number
  leave_balance: number
  is_active: boolean
  created_at: string
  updated_at: string
  department?: Department
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
  hours_late_decimal: number
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
