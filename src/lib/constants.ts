// Shared app constants (single source of truth — avoid magic strings/numbers).

// Default password assigned to new/reset employee accounts. Accounts created or
// reset with this value are flagged must_change_password and forced to change it
// on first portal use.
export const DEFAULT_EMPLOYEE_PASSWORD = '123456'

// Minimum password length accepted by change/reset/admin-create flows.
export const MIN_PASSWORD_LENGTH = 6

// Leave type names that have special business rules. Resolved to ids at runtime
// (never hardcode the SERIAL id — it can drift after re-seed/cleanup).
export const LEAVE_TYPE_EMERGENCY = 'Emergency'
export const LEAVE_TYPE_SICK = 'Sick'
export const LEAVE_TYPE_ANNUAL = 'Annual'

// Emergency leave cap (days per fiscal year).
export const EMERGENCY_LEAVE_MAX_DAYS = 5
// Sick leave days above which notes are required.
export const SICK_LEAVE_NOTES_THRESHOLD = 3
// Maximum consecutive leave days in a single request.
export const MAX_CONSECUTIVE_LEAVE_DAYS = 30

// Default office geofence radius (metres) when none configured.
export const DEFAULT_OFFICE_RADIUS_M = 200

// Sanity cap for a single computed work shift (hours) — guards overnight/skew math.
export const MAX_SHIFT_HOURS = 16

// Grace period (minutes) before a late check-in is recorded as tardiness. The single
// tuning point for the auto-tardiness rule (0 = no grace, current behaviour).
export const TARDINESS_GRACE_MINUTES = 0

// Note stamped on the leave the daily automation auto-creates for an unexcused absence.
// Used to find + reverse that deduction when an admin corrects/deletes the absence.
export const AUTO_ABSENCE_LEAVE_NOTE = 'Auto-deducted: absent without leave'

// Tardiness penalty: late minutes are converted to annual-leave-days proportionally —
// one full workday of accumulated lateness costs one leave day. So with an 8h workday,
// 480 late-minutes = 1 day and 2 late-minutes = 2/480 ≈ 0.004 day. Set to false to
// disable the penalty (tardiness then only tracks punctuality, no balance impact).
export const TARDINESS_DEDUCTS_LEAVE = true

// Grace forgiven BEFORE charging leave: the first N late minutes each day cost nothing;
// only minutes beyond this are converted to a leave deduction. The lateness is still
// recorded for punctuality tracking — this only affects the penalty. (Distinct from
// TARDINESS_GRACE_MINUTES, which controls whether lateness is logged at all.)
export const TARDINESS_PENALTY_GRACE_MINUTES = 10
