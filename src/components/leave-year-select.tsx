'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getSettings, getLeaveRequestsInSpan, getTardinessInSpan, getPermissions } from '@/lib/api'
import { useT } from '@/lib/language-context'
import { leaveYears, leaveYearLabel, type LeaveYear } from '@/lib/leave-year'
import { qk } from '@/lib/query-keys'

/**
 * The leave year a report is showing. Defaults to the current one.
 *
 * `year` is null until settings have loaded. Treat that as "no data yet", not "all
 * years": totalling everything was exactly the bug this replaces.
 */
export function useLeaveYear() {
  const { data: settings } = useQuery({ queryKey: qk.settings(), queryFn: getSettings })
  const years = useMemo(() => (settings ? leaveYears(settings) : []), [settings])
  const [index, setIndex] = useState(0)
  const year: LeaveYear | null = years[index] ?? null
  return { years, year, index, setIndex }
}

/** The current leave year, for pages that only ever show that one. Null until settings load. */
export function useCurrentLeaveYear(): LeaveYear | null {
  const { data: settings } = useQuery({ queryKey: qk.settings(), queryFn: getSettings })
  return useMemo(() => (settings ? leaveYears(settings, 1)[0] : null), [settings])
}

// One leave year's rows, fetched as just that year. The reports used to download every
// leave request and tardiness row ever recorded and filter in the browser, so each page
// load grew with the company's history. Nothing is fetched until the year is known.
// Keys sit under qk.leaves()/qk.tardiness(), so every mutation that refreshes the full
// lists refreshes these too.

const NO_YEAR = { start: '', end: '' }

export function useLeavesInYear(year: LeaveYear | null) {
  return useQuery({
    queryKey: qk.leavesInSpan(year ?? NO_YEAR),
    queryFn: () => getLeaveRequestsInSpan(year!),
    enabled: !!year,
  })
}

export function useTardinessInYear(year: LeaveYear | null) {
  return useQuery({
    queryKey: qk.tardinessInSpan(year ?? NO_YEAR),
    queryFn: () => getTardinessInSpan(year!),
    enabled: !!year,
  })
}

export function usePermissionsInYear(year: LeaveYear | null) {
  return useQuery({
    queryKey: qk.permissionsInSpan(year ?? NO_YEAR),
    queryFn: () => getPermissions(year!),
    enabled: !!year,
  })
}

export function LeaveYearSelect({
  years,
  index,
  onChange,
}: {
  years: LeaveYear[]
  index: number
  onChange: (index: number) => void
}) {
  const t = useT()
  const label = (y: LeaveYear) => `${leaveYearLabel(y)}${y.isCurrent ? ` (${t('currentLeaveYear')})` : ''}`
  const selected = years[index]

  return (
    <Select value={String(index)} onValueChange={v => onChange(Number(v ?? 0))}>
      <SelectTrigger className="w-44" aria-label={t('leaveYear')}>
        <SelectValue placeholder={t('leaveYear')}>{selected ? label(selected) : null}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {years.map((y, i) => (
          <SelectItem key={y.start} value={String(i)}>{label(y)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
