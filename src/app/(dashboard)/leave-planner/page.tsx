'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { getEmployees, getLeaveRequests, getLeaveTypes, getSettings, getDepartments } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'

const MONTH_NAMES_AR = ['مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير']
const MONTH_NAMES_EN = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb']
const FISCAL_MONTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1] // March(2) to February(1)

export default function LeavePlannerPage() {
  const t = useT()
  const { lang } = useLanguage()
  const [deptFilter, setDeptFilter] = useState<string>('all')

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })

  const monthNames = lang === 'ar' ? MONTH_NAMES_AR : MONTH_NAMES_EN

  const plannerData = useMemo(() => {
    let emps = employees.filter(e => e.is_active)
    if (deptFilter !== 'all') emps = emps.filter(e => e.department_id === parseInt(deptFilter))

    return emps.map(emp => {
      const empLeaves = leaves.filter(l => l.employee_id === emp.id && l.status === 'approved')
      const usedDays = empLeaves.reduce((sum, l) => sum + l.days_count, 0)
      const remaining = emp.leave_balance

      // Build month-by-month data
      const months = FISCAL_MONTHS.map((monthIdx, fiscalIdx) => {
        const year = fiscalIdx < 10 ? (settings?.year_start ? new Date(settings.year_start).getFullYear() : 2026) : (settings?.year_end ? new Date(settings.year_end).getFullYear() : 2027)

        // Count leave days in this month for this employee
        let daysInMonth = 0
        const leaveColors: string[] = []

        empLeaves.forEach(leave => {
          const start = new Date(leave.start_date)
          const end = new Date(leave.end_date)

          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            if (d.getMonth() === monthIdx && d.getFullYear() === year) {
              daysInMonth++
              const lt = leaveTypes.find(t => t.id === leave.leave_type_id)
              if (lt && !leaveColors.includes(lt.color)) leaveColors.push(lt.color)
            }
          }
        })

        return { month: monthIdx, days: daysInMonth, colors: leaveColors }
      })

      return {
        id: emp.id,
        name: emp.name,
        department: emp.department?.name || '',
        balance: settings?.annual_leave_balance || 30,
        used: usedDays,
        remaining,
        months,
      }
    })
  }, [employees, leaves, leaveTypes, settings, deptFilter])

  const maxDaysInMonth = Math.max(...plannerData.flatMap(e => e.months.map(m => m.days)), 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('leavePlanner')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('fiscalYear')}: {settings?.year_start} → {settings?.year_end}
          </p>
        </div>
        <Select value={deptFilter} onValueChange={(v) => setDeptFilter(v ?? 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('allDepts')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allDepts')}</SelectItem>
            {departments.map(d => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap">
        {leaveTypes.map(lt => (
          <div key={lt.id} className="flex items-center gap-1.5 text-sm">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: lt.color }} />
            <span>{lang === 'ar' ? lt.name_ar : lt.name_en}</span>
          </div>
        ))}
      </div>

      {/* Planner Grid */}
      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-start p-3 sticky start-0 bg-card z-10 min-w-[160px]">{t('name')}</th>
                  <th className="text-center p-2 min-w-[40px]">{t('balance')}</th>
                  <th className="text-center p-2 min-w-[40px]">{t('used')}</th>
                  <th className="text-center p-2 min-w-[40px]">{t('remaining')}</th>
                  {monthNames.map((m, i) => (
                    <th key={i} className="text-center p-2 min-w-[44px] text-xs font-medium text-muted-foreground">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plannerData.map(emp => (
                  <tr key={emp.id} className="border-b hover:bg-accent/30 transition-colors">
                    <td className="p-3 font-medium sticky start-0 bg-card z-10">
                      <div>
                        <span className="text-sm">{emp.name}</span>
                        <span className="text-[10px] text-muted-foreground block">{emp.department}</span>
                      </div>
                    </td>
                    <td className="text-center p-2 text-xs">{emp.balance}</td>
                    <td className="text-center p-2 text-xs font-semibold">{emp.used}</td>
                    <td className="text-center p-2">
                      <span className={`text-xs font-bold ${emp.remaining < 5 ? 'text-rose-500' : emp.remaining < 15 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {emp.remaining}
                      </span>
                    </td>
                    {emp.months.map((m, i) => (
                      <td key={i} className="text-center p-1">
                        {m.days > 0 ? (
                          <div className="relative">
                            <div
                              className="mx-auto rounded-sm transition-all"
                              style={{
                                width: '32px',
                                height: `${Math.max(16, m.days / maxDaysInMonth * 36)}px`,
                                background: m.colors.length === 1 ? m.colors[0] : m.colors.length > 1
                                  ? `linear-gradient(180deg, ${m.colors.join(', ')})`
                                  : '#666',
                                opacity: 0.8,
                              }}
                            />
                            <span className="text-[9px] font-bold absolute inset-0 flex items-center justify-center text-white drop-shadow-sm">
                              {m.days}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/30">·</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
