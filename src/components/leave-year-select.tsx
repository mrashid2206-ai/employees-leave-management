'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getSettings } from '@/lib/api'
import { useT } from '@/lib/language-context'
import { leaveYears, leaveYearLabel, type LeaveYear } from '@/lib/leave-year'

/**
 * The leave year a report is showing. Defaults to the current one.
 *
 * `year` is null until settings have loaded. Treat that as "no data yet", not "all
 * years": totalling everything was exactly the bug this replaces.
 */
export function useLeaveYear() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const years = useMemo(() => (settings ? leaveYears(settings) : []), [settings])
  const [index, setIndex] = useState(0)
  const year: LeaveYear | null = years[index] ?? null
  return { years, year, index, setIndex }
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
