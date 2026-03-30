'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { getEmployees, getLeaveRequests, getLeaveTypes, getDepartments } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'

const DAY_NAMES_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function CalendarPage() {
  const t = useT()
  const { lang, dir } = useLanguage()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [deptFilter, setDeptFilter] = useState<string>('all')

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()

  const filteredEmployees = useMemo(() => {
    let emps = employees.filter(e => e.is_active)
    if (deptFilter !== 'all') {
      emps = emps.filter(e => e.department_id === parseInt(deptFilter))
    }
    return emps
  }, [employees, deptFilter])

  // Build calendar data: for each day, which employees are on leave
  const calendarData = useMemo(() => {
    const days: { day: number; employees: { id: number; name: string; leaveType: string; color: string }[] }[] = []

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const empsOnLeave = leaves
        .filter(l => {
          if (l.status !== 'approved') return false
          if (l.start_date > dateStr || l.end_date < dateStr) return false
          const emp = filteredEmployees.find(e => e.id === l.employee_id)
          return !!emp
        })
        .map(l => {
          const emp = employees.find(e => e.id === l.employee_id)
          const lt = leaveTypes.find(t => t.id === l.leave_type_id)
          return {
            id: l.employee_id,
            name: emp?.name || '',
            leaveType: lang === 'ar' ? (lt?.name_ar || '') : (lt?.name_en || ''),
            color: lt?.color || '#666',
          }
        })

      days.push({ day: d, employees: empsOnLeave })
    }
    return days
  }, [year, month, daysInMonth, leaves, filteredEmployees, employees, leaveTypes])

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1))
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  const today = new Date()
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day

  // Build grid cells
  const gridCells: (null | typeof calendarData[number])[] = []
  for (let i = 0; i < firstDayOfWeek; i++) gridCells.push(null)
  calendarData.forEach(d => gridCells.push(d))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t('calendar')}</h1>
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

      <Card className="border-0 shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={nextMonth}>
              <ChevronRight className="h-5 w-5" />
            </Button>
            <CardTitle className="text-xl">
              {(lang === 'ar' ? MONTH_NAMES_AR : MONTH_NAMES_EN)[month]} {year}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={prevMonth}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {(lang === 'ar' ? DAY_NAMES_AR : DAY_NAMES_EN).map(day => (
              <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {gridCells.map((cell, idx) => {
              const hasMany = cell && cell.employees.length > 4

              const cellContent = (
                <div
                  key={idx}
                  className={`min-h-[100px] rounded-lg p-1.5 border transition-colors ${
                    cell === null
                      ? 'bg-transparent border-transparent'
                      : isToday(cell.day)
                      ? 'border-[#1976D2] bg-[#1976D2]/5'
                      : cell && cell.employees.length > 0
                      ? 'border-border hover:bg-accent/50 cursor-pointer'
                      : 'border-border'
                  }`}
                >
                  {cell && (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-medium ${isToday(cell.day) ? 'text-[#1976D2]' : ''}`}>
                          {cell.day}
                        </span>
                        {cell.employees.length > 0 && (
                          <span className="text-[9px] font-bold text-muted-foreground bg-muted rounded-full w-4 h-4 flex items-center justify-center">
                            {cell.employees.length}
                          </span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {cell.employees.map((emp, i) => (
                          <div
                            key={i}
                            className="text-[10px] leading-tight px-1.5 py-0.5 rounded truncate text-white"
                            style={{ backgroundColor: emp.color }}
                            title={`${emp.name} - ${emp.leaveType}`}
                          >
                            {emp.name.split(' ')[0]}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )

              if (cell && cell.employees.length > 0) {
                return (
                  <Popover key={idx}>
                    <PopoverTrigger render={<div />}>
                      {cellContent}
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" dir={dir}>
                      <div className="p-3 border-b">
                        <h4 className="font-bold text-sm">
                          {cell.day} {(lang === 'ar' ? MONTH_NAMES_AR : MONTH_NAMES_EN)[month]} — {cell.employees.length} {lang === 'ar' ? 'موظف' : 'employees'}
                        </h4>
                      </div>
                      <div className="p-2 space-y-1.5 max-h-60 overflow-y-auto">
                        {cell.employees.map((emp, i) => (
                          <div key={i} className="flex items-center gap-2 p-1.5 rounded hover:bg-accent/50">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: emp.color }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{emp.name}</p>
                              <p className="text-[11px] text-muted-foreground">{emp.leaveType}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )
              }

              return <div key={idx}>{cellContent}</div>
            })}
          </div>

          {/* Legend */}
          <div className="flex gap-4 mt-4 flex-wrap">
            {leaveTypes.map(lt => (
              <div key={lt.id} className="flex items-center gap-1.5 text-sm">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: lt.color }} />
                <span>{lang === 'ar' ? lt.name_ar : lt.name_en}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
