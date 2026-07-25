'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Download, Printer } from 'lucide-react'
import { getEmployees, getDepartments, getLeaveRequests, getLeaveTypes, getTardinessRecords, getHolidays } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'
import { exportToExcel } from '@/lib/excel'
import { QueryError } from '@/components/query-error'

interface AttendanceRow {
  employee_id: number
  date: string
  status: string
  work_hours: string | number
  overtime_hours: string | number
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// One consolidated month-end sheet per employee: attendance, overtime, leave by type,
// lateness and its leave cost — everything whoever closes the month needs, in one export.
export default function MonthlyReportPage() {
  const t = useT()
  const { lang, dir } = useLanguage()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [deptFilter, setDeptFilter] = useState<string>('all')

  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const lastDay = new Date(year, month, 0).getDate()
  const monthStart = `${monthKey}-01`
  const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`

  const monthNames = lang === 'ar'
    ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: holidays = [] } = useQuery({ queryKey: ['holidays'], queryFn: getHolidays })
  const { data: attendance = [], isError, refetch } = useQuery<AttendanceRow[]>({
    queryKey: ['attendance-monthly', monthKey],
    queryFn: () => fetch(`/api/attendance?month=${monthKey}`).then(r => r.json()),
  })

  const holidaySet = useMemo(() => new Set(holidays.map(h => h.date)), [holidays])
  const dedupedTypes = useMemo(
    () => leaveTypes.filter((lt, i, arr) => arr.findIndex(x => x.name_en === lt.name_en) === i),
    [leaveTypes]
  )

  const rows = useMemo(() => {
    let emps = employees.filter(e => e.is_active)
    if (deptFilter !== 'all') emps = emps.filter(e => e.department_id === parseInt(deptFilter))

    return emps.map(emp => {
      const empAtt = attendance.filter(a => a.employee_id === emp.id)
      const present = empAtt.filter(a => a.status === 'present')
      const daysWorked = present.length
      const absentDays = empAtt.filter(a => a.status === 'absent').length
      const workHours = present.reduce((s, a) => s + (parseFloat(String(a.work_hours)) || 0), 0)
      const overtime = present.reduce((s, a) => s + (parseFloat(String(a.overtime_hours)) || 0), 0)

      // Leave days that fall inside this month, holidays excluded (matches days_count).
      const byType: Record<string, number> = {}
      let leaveDays = 0
      for (const l of leaves) {
        if (l.employee_id !== emp.id || l.status !== 'approved') continue
        if (l.end_date < monthStart || l.start_date > monthEnd) continue
        const [sy, sm, sd] = l.start_date.split('-').map(Number)
        const [ey, em, ed] = l.end_date.split('-').map(Number)
        let daysInMonth = 0
        for (let ms = Date.UTC(sy, sm - 1, sd); ms <= Date.UTC(ey, em - 1, ed); ms += 86400000) {
          const iso = new Date(ms).toISOString().split('T')[0]
          if (iso < monthStart || iso > monthEnd) continue
          if (holidaySet.has(iso)) continue
          daysInMonth++
        }
        if (daysInMonth === 0) continue
        leaveDays += daysInMonth
        const typeName = dedupedTypes.find(x => x.id === l.leave_type_id)?.name_en
          || leaveTypes.find(x => x.id === l.leave_type_id)?.name_en
          || 'Other'
        byType[typeName] = (byType[typeName] || 0) + daysInMonth
      }

      const empTard = tardiness.filter(x => x.employee_id === emp.id && x.date >= monthStart && x.date <= monthEnd)
      const lateCount = empTard.length
      const lateMinutes = empTard.reduce((s, x) => s + x.minutes_late, 0)
      const leaveDeducted = empTard.reduce((s, x) => s + (x.leave_deducted || 0), 0)

      return {
        id: emp.id,
        name: emp.name,
        department: emp.department?.name || '',
        daysWorked,
        absentDays,
        workHours: Math.round(workHours * 100) / 100,
        overtime: Math.round(overtime * 100) / 100,
        leaveDays,
        byType,
        lateCount,
        lateMinutes,
        leaveDeducted: Math.round(leaveDeducted * 1000) / 1000,
        balance: emp.leave_balance,
      }
    })
  }, [employees, attendance, leaves, tardiness, holidaySet, dedupedTypes, leaveTypes, deptFilter, monthStart, monthEnd])

  function handleExport() {
    const data = rows.map(r => {
      const base: Record<string, string | number> = {
        [t('name')]: r.name,
        [t('department')]: r.department,
        [t('daysWorked')]: r.daysWorked,
        [t('absentDays2')]: r.absentDays,
        [t('workHours')]: r.workHours,
        [t('overtime')]: r.overtime,
        [t('leaveDays')]: r.leaveDays,
      }
      for (const lt of dedupedTypes) {
        base[lang === 'ar' ? lt.name_ar : lt.name_en] = r.byType[lt.name_en] || 0
      }
      base[t('lateCount')] = r.lateCount
      base[t('lateMinutes')] = r.lateMinutes
      base[t('leaveDeductedLateness')] = r.leaveDeducted
      base[t('remaining')] = r.balance
      return base
    })
    exportToExcel(data, `monthly-report-${monthKey}`, t('monthlyReport'))
  }

  const totals = {
    daysWorked: rows.reduce((s, r) => s + r.daysWorked, 0),
    absent: rows.reduce((s, r) => s + r.absentDays, 0),
    workHours: Math.round(rows.reduce((s, r) => s + r.workHours, 0) * 10) / 10,
    overtime: Math.round(rows.reduce((s, r) => s + r.overtime, 0) * 10) / 10,
    leaveDays: rows.reduce((s, r) => s + r.leaveDays, 0),
    lateMinutes: rows.reduce((s, r) => s + r.lateMinutes, 0),
    deducted: Math.round(rows.reduce((s, r) => s + r.leaveDeducted, 0) * 1000) / 1000,
  }

  return (
    <div className="space-y-6" dir={dir}>
      {isError && <QueryError onRetry={() => refetch()} />}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t('monthlyReport')}</h1>
        <div className="flex gap-2 flex-wrap">
          <Select value={String(year)} onValueChange={v => setYear(parseInt(v ?? String(now.getFullYear())))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={v => setMonth(parseInt(v ?? '1'))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthNames.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={v => setDeptFilter(v ?? 'all')}>
            <SelectTrigger className="w-36"><SelectValue placeholder={t('allDepts')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allDepts')}</SelectItem>
              {departments.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 me-1.5" />
            {t('exportExcel')}
          </Button>
          <Button variant="outline" onClick={() => window.print()} className="no-print">
            <Printer className="h-4 w-4 me-1.5" />
            {t('print')}
          </Button>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t('name')}</TableHead>
                  <TableHead className="text-center">{t('department')}</TableHead>
                  <TableHead className="text-center">{t('worked')}</TableHead>
                  <TableHead className="text-center">{t('absent')}</TableHead>
                  <TableHead className="text-center">{t('workHours')}</TableHead>
                  <TableHead className="text-center">{t('overtime')}</TableHead>
                  <TableHead className="text-center">{t('leave')}</TableHead>
                  {dedupedTypes.map(lt => (
                    <TableHead key={lt.id} className="text-center">{lang === 'ar' ? lt.name_ar : lt.name_en}</TableHead>
                  ))}
                  <TableHead className="text-center">{t('tardinessHHMM')}</TableHead>
                  <TableHead className="text-center">{t('deducted')}</TableHead>
                  <TableHead className="text-center">{t('remaining')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10 + dedupedTypes.length} className="text-center py-8 text-muted-foreground">{t('noData')}</TableCell>
                  </TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-center">{r.department}</TableCell>
                    <TableCell className="text-center">{r.daysWorked}</TableCell>
                    <TableCell className="text-center">{r.absentDays > 0 ? <span className="text-rose-500 font-semibold">{r.absentDays}</span> : '-'}</TableCell>
                    <TableCell className="text-center font-mono">{r.workHours}h</TableCell>
                    <TableCell className="text-center font-mono">{r.overtime > 0 ? <span className="text-amber-500">+{r.overtime}h</span> : '-'}</TableCell>
                    <TableCell className="text-center">{r.leaveDays || '-'}</TableCell>
                    {dedupedTypes.map(lt => (
                      <TableCell key={lt.id} className="text-center">{r.byType[lt.name_en] || 0}</TableCell>
                    ))}
                    <TableCell className="text-center font-mono">{r.lateMinutes > 0 ? hhmm(r.lateMinutes) : '-'}</TableCell>
                    <TableCell className="text-center font-mono text-amber-600">{r.leaveDeducted > 0 ? `-${r.leaveDeducted.toFixed(3)}` : '-'}</TableCell>
                    <TableCell className="text-center font-bold">{r.balance}</TableCell>
                  </TableRow>
                ))}
                {rows.length > 0 && (
                  <TableRow className="border-t-2 font-bold">
                    <TableCell colSpan={2} className="text-start">{t('total')}</TableCell>
                    <TableCell className="text-center">{totals.daysWorked}</TableCell>
                    <TableCell className="text-center">{totals.absent}</TableCell>
                    <TableCell className="text-center font-mono">{totals.workHours}h</TableCell>
                    <TableCell className="text-center font-mono">+{totals.overtime}h</TableCell>
                    <TableCell className="text-center">{totals.leaveDays}</TableCell>
                    {dedupedTypes.map(lt => <TableCell key={lt.id} />)}
                    <TableCell className="text-center font-mono">{hhmm(totals.lateMinutes)}</TableCell>
                    <TableCell className="text-center font-mono text-amber-600">-{totals.deducted.toFixed(3)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
