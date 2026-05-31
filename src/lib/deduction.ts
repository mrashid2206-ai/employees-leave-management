// Single source of truth for tardiness salary deduction so every screen agrees.
// Derive directly from minutes (no intermediate hour rounding) and round money to 3dp.
export function computeDeduction(totalMinutesLate: number, deductionPerHour: number): number {
  return Math.round((totalMinutesLate / 60) * deductionPerHour * 1000) / 1000
}
