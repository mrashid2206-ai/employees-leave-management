import { z } from 'zod'

const id = z.coerce.number().int().positive()
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'must be a HH:MM time')

// .passthrough() keeps unknown keys so validation only ever *adds* a guard against
// missing/invalid required fields — it never rejects an existing valid payload.

// ---- Leave ----------------------------------------------------------------------
export const leaveCreateSchema = z
  .object({
    employee_id: id,
    leave_type_id: id,
    start_date: dateStr,
    end_date: dateStr,
    days_count: z.coerce.number().positive(),
    notes: z.string().nullish(),
    is_half_day: z.boolean().optional(),
    status: z.string().optional(),
    force: z.boolean().optional(),
  })
  .passthrough()

export const leaveStatusSchema = z
  .object({ status: z.enum(['approved', 'rejected', 'pending']) })
  .passthrough()

export const leaveEditSchema = z
  .object({ start_date: dateStr, end_date: dateStr })
  .passthrough()

// ---- Attendance -----------------------------------------------------------------
export const checkInSchema = z
  .object({
    employee_id: id,
    action: z.enum(['check-in', 'check-out']),
    latitude: z.coerce.number().nullish(),
    longitude: z.coerce.number().nullish(),
  })
  .passthrough()

export const attendanceRecordSchema = z
  .object({
    employee_id: id,
    date: dateStr,
    check_in: z.string().nullish(),
    check_out: z.string().nullish(),
    status: z.string().optional(),
    notes: z.string().nullish(),
  })
  .passthrough()

// Bulk-or-single: the route accepts an array or a lone object.
export const attendanceUpsertSchema = z.union([
  attendanceRecordSchema,
  z.array(attendanceRecordSchema).min(1),
])

export const attendanceUpdateSchema = z
  .object({
    check_in: z.string().nullish(),
    check_out: z.string().nullish(),
    work_hours: z.coerce.number().nullish(),
    overtime_hours: z.coerce.number().nullish(),
    status: z.string().optional(),
    notes: z.string().nullish(),
    is_holiday_work: z.boolean().optional(),
    excused_tardiness: z.boolean().optional(),
  })
  .passthrough()

// ---- Tardiness ------------------------------------------------------------------
export const tardinessRecordSchema = z
  .object({
    employee_id: id,
    date: dateStr,
    time: timeStr,
    minutes_late: z.coerce.number().int().positive(),
    notes: z.string().nullish(),
  })
  .passthrough()

export const tardinessCreateSchema = z.union([
  tardinessRecordSchema,
  z.array(tardinessRecordSchema).min(1),
])

// ---- Permissions ----------------------------------------------------------------
export const permissionCreateSchema = z
  .object({
    employee_id: id,
    date: dateStr,
    leave_time: timeStr,
    reason: z.string().nullish(),
  })
  .passthrough()

export const permissionUpdateSchema = z
  .object({
    return_time: timeStr.optional(),
    status: z.enum(['approved', 'rejected', 'pending']).optional(),
  })
  .passthrough()

// ---- People & reference data ----------------------------------------------------
export const employeeCreateSchema = z
  .object({
    name: z.string().min(1),
    department_id: id,
    leave_balance: z.coerce.number().optional(),
    join_date: dateStr.nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    position: z.string().nullish(),
  })
  .passthrough()

export const departmentSchema = z.object({ name: z.string().min(1) }).passthrough()

export const holidaySchema = z
  .object({ name: z.string().min(1), date: dateStr })
  .passthrough()

export const leaveTypeSchema = z
  .object({
    name_ar: z.string().min(1),
    name_en: z.string().min(1),
    color: z.string().min(1),
  })
  .passthrough()

// ---- Settings -------------------------------------------------------------------
export const settingsUpdateSchema = z
  .object({
    year_start: dateStr.optional(),
    year_end: dateStr.optional(),
    annual_leave_balance: z.coerce.number().int().positive().optional(),
    deduction_per_hour: z.coerce.number().min(0).optional(),
    work_hours_per_day: z.coerce.number().int().positive().optional(),
    max_absent_same_dept: z.coerce.number().int().positive().optional(),
    work_start_time: z.string().optional(),
    work_days: z.string().optional(),
    office_radius: z.coerce.number().min(0).nullish(),
  })
  .passthrough()
