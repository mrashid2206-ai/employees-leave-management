// Convert late minutes into an annual-leave-day deduction, proportional to the workday:
// one full workday of lateness (work_hours_per_day × 60 minutes) costs exactly one leave
// day. A grace period is forgiven first — only minutes BEYOND the grace are charged, so a
// short lateness within the grace costs nothing. Rounded to 3 decimals to match the
// leave_balance column precision so even small charged latenesses register (not rounded to 0).
export function tardinessLeaveDeduction(
  minutesLate: number,
  workHoursPerDay: number,
  graceMinutes: number = 0
): number {
  const chargeable = minutesLate - (graceMinutes > 0 ? graceMinutes : 0)
  if (chargeable <= 0) return 0
  const minutesPerDay = (workHoursPerDay > 0 ? workHoursPerDay : 8) * 60
  return Math.round((chargeable / minutesPerDay) * 1000) / 1000
}
