'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { getDepartments, getSettings, updateDepartment } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'
import { ScheduleFields } from '@/components/schedule-fields'
import type { DepartmentUpdate } from '@/lib/types'

// Per-department working hours. Every field is optional — blank means "inherit the
// global schedule above", so a company with one schedule never has to touch this.
export function DepartmentSchedules() {
  const t = useT()
  const { lang } = useLanguage()
  const queryClient = useQueryClient()

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

        return (
          <div key={dept.id} className="p-4 rounded-xl bg-accent/20 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">{dept.name}</p>
              {!dept.work_start_time && !dept.work_days && !dept.work_hours_per_day && (
                <Badge variant="outline" className="text-[10px]">
                  {t('inheritsGlobal')}
                </Badge>
              )}
            </div>

            <ScheduleFields
              value={{
                work_start_time: valueFor(dept.id, 'work_start_time', dept.work_start_time) as string | null,
                work_days: valueFor(dept.id, 'work_days', dept.work_days) as string | null,
                work_hours_per_day: valueFor(dept.id, 'work_hours_per_day', dept.work_hours_per_day) as number | null,
              }}
              onChange={patch => {
                for (const [field, v] of Object.entries(patch)) {
                  setDraft(dept.id, field as keyof DepartmentUpdate, v as string | number | null)
                }
              }}
              fallback={{
                work_start_time: settings?.work_start_time,
                work_days: settings?.work_days,
                work_hours_per_day: settings?.work_hours_per_day,
              }}
            />

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
