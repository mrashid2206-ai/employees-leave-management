'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLanguage, useT } from '@/lib/language-context'
import type { ScheduleOverride } from '@/lib/types'

// The three fields of an overridable work schedule, shared by the department editor and
// the employee editor so the two can never drift apart.
//
// Every field is optional. Blank = inherit, and `fallback` is what would be inherited, so
// the placeholders always show the schedule that is actually in force rather than a
// hardcoded guess.

const DAY_LABELS_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const DAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface ScheduleFallback {
  work_start_time?: string | null
  work_days?: string | null
  work_hours_per_day?: number | null
}

interface Props {
  value: ScheduleOverride
  onChange: (patch: ScheduleOverride) => void
  fallback: ScheduleFallback
}

export function ScheduleFields({ value, onChange, fallback }: Props) {
  const t = useT()
  const { lang } = useLanguage()
  const dayLabels = lang === 'ar' ? DAY_LABELS_AR : DAY_LABELS_EN

  const daysValue = String(value.work_days ?? '')
  const selectedDays = daysValue ? daysValue.split(',').map(Number) : null
  const inheritedDays = (fallback.work_days || '0,1,2,3,4').split(',').map(Number)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{t('workStartTime')}</Label>
          <Input
            type="time"
            value={String(value.work_start_time ?? '').slice(0, 5)}
            placeholder={fallback.work_start_time?.slice(0, 5) || '08:00'}
            onChange={e => onChange({ work_start_time: e.target.value === '' ? null : e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs">{t('workHoursPerDay')}</Label>
          <Input
            type="number"
            min="1"
            value={value.work_hours_per_day ?? ''}
            placeholder={String(fallback.work_hours_per_day || 8)}
            onChange={e => onChange({ work_hours_per_day: e.target.value === '' ? null : parseInt(e.target.value) })}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs mb-1.5 block">{t('workDays')}</Label>
        <div className="flex flex-wrap gap-1.5">
          {dayLabels.map((label, i) => {
            // With no override set, show the inherited days as the (inactive) baseline.
            const active = selectedDays ? selectedDays.includes(i) : false
            const inherited = !selectedDays && inheritedDays.includes(i)
            return (
              <button
                key={i}
                type="button"
                className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : inherited
                      ? 'bg-background text-foreground border-dashed'
                      : 'bg-background text-muted-foreground'
                }`}
                onClick={() => {
                  const base = selectedDays ?? inheritedDays
                  const updated = base.includes(i) ? base.filter(d => d !== i) : [...base, i].sort()
                  onChange({ work_days: updated.join(',') })
                }}
              >
                {label}
              </button>
            )
          })}
          {selectedDays && (
            <button
              type="button"
              className="px-2.5 py-1 rounded-lg text-xs text-muted-foreground underline"
              onClick={() => onChange({ work_days: null })}
            >
              {t('inherit')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
