'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { getDepartments, getSettings, updateDepartment } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'
import type { DepartmentUpdate } from '@/lib/types'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const DAY_LABELS_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const DAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Per-department working hours. Every field is optional — blank means "inherit the
// global schedule above", so a company with one schedule never has to touch this.
export function DepartmentSchedules() {
  const t = useT()
  const { lang } = useLanguage()
  const queryClient = useQueryClient()
  const dayLabels = lang === 'ar' ? DAY_LABELS_AR : DAY_LABELS_EN

  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const [drafts, setDrafts] = useState<Record<number, DepartmentUpdate>>({})

  const mutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: DepartmentUpdate }) => updateDepartment(id, data),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setDrafts(d => {
        const next = { ...d }
        delete next[vars.id]
        return next
      })
      toast.success(t('savedSuccess'))
    },
    onError: () => toast.error(t('error')),
  })

  function valueFor(deptId: number, field: keyof DepartmentUpdate, stored: string | number | null | undefined) {
    const draft = drafts[deptId]?.[field]
    return draft !== undefined ? draft : (stored ?? '')
  }

  function setDraft(deptId: number, field: keyof DepartmentUpdate, value: string | number | null) {
    setDrafts(d => ({ ...d, [deptId]: { ...d[deptId], [field]: value } }))
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {lang === 'ar'
          ? 'اترك الحقل فارغاً ليتبع القسم الدوام العام أعلاه. يُستخدم هذا الدوام لحساب التأخير والساعات الإضافية وأيام العمل لكل موظف في القسم.'
          : 'Leave a field blank to inherit the global schedule above. This schedule drives tardiness, overtime and working days for everyone in the department.'}
      </p>

      {departments.map(dept => {
        const draft = drafts[dept.id]
        const daysValue = String(valueFor(dept.id, 'work_days', dept.work_days) || '')
        const selectedDays = daysValue ? daysValue.split(',').map(Number) : null

        return (
          <div key={dept.id} className="p-4 rounded-xl bg-accent/20 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">{dept.name}</p>
              {!dept.work_start_time && !dept.work_days && !dept.work_hours_per_day && (
                <Badge variant="outline" className="text-[10px]">
                  {lang === 'ar' ? 'يتبع الدوام العام' : 'inherits global'}
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('workStartTime')}</Label>
                <Input
                  type="time"
                  value={String(valueFor(dept.id, 'work_start_time', dept.work_start_time?.slice(0, 5)) || '')}
                  placeholder={settings?.work_start_time?.slice(0, 5) || '08:00'}
                  onChange={e => setDraft(dept.id, 'work_start_time', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">{t('workHoursPerDay')}</Label>
                <Input
                  type="number"
                  min="1"
                  value={String(valueFor(dept.id, 'work_hours_per_day', dept.work_hours_per_day) || '')}
                  placeholder={String(settings?.work_hours_per_day || 8)}
                  onChange={e => setDraft(dept.id, 'work_hours_per_day', e.target.value === '' ? null : parseInt(e.target.value))}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1.5 block">{t('workDays')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAY_KEYS.map((_key, i) => {
                  const active = selectedDays ? selectedDays.includes(i) : false
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground'
                      }`}
                      onClick={() => {
                        const base = selectedDays ?? (settings?.work_days || '0,1,2,3,4').split(',').map(Number)
                        const updated = base.includes(i) ? base.filter(d => d !== i) : [...base, i].sort()
                        setDraft(dept.id, 'work_days', updated.join(','))
                      }}
                    >
                      {dayLabels[i]}
                    </button>
                  )
                })}
                {selectedDays && (
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded-lg text-xs text-muted-foreground underline"
                    onClick={() => setDraft(dept.id, 'work_days', null)}
                  >
                    {lang === 'ar' ? 'إعادة للعام' : 'inherit'}
                  </button>
                )}
              </div>
            </div>

            <Button
              size="sm"
              disabled={!draft || mutation.isPending}
              onClick={() => mutation.mutate({ id: dept.id, data: draft || {} })}
            >
              <Save className="h-3.5 w-3.5 me-1.5" />
              {t('save')}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
