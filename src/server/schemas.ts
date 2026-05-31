import { z } from 'zod'

const id = z.coerce.number().int().positive()
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')

// .passthrough() keeps unknown keys so this only ever *adds* a guard against
// missing/invalid required fields — it never rejects an existing valid payload.

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

export const checkInSchema = z
  .object({
    employee_id: id,
    action: z.enum(['check-in', 'check-out']),
    latitude: z.coerce.number().nullish(),
    longitude: z.coerce.number().nullish(),
  })
  .passthrough()

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
