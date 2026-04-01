'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Download, Printer, Clock, TrendingUp, Users } from 'lucide-react'
import { getEmployees, getDepartments } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'
import { exportToExcel } from '@/lib/excel'

interface AttendanceRecord {
  id: number
  employee_id: number
  date: string
  check_in: string | null
  check_out: string | null
  work_hours: string | number
  overtime_hours: string | number
  status: string
  employee?: { id: number; name: string; department_id: number }
}

export default function OvertimeReportPage() {
  const t = useT()
  const { lang, dir } = useLanguage()
  const [deptFilter, setDeptFilter] = useState<string>('all')

  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)

  const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: records = [] } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-ot', monthKey],
    queryFn: () => fetch(`/api/attendance?month=${monthKey}`).then(r => r.json()),
  })

  const monthNames = lang === 'ar'
    ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const reportData = useMemo(() => {
    let emps = employees.filter(e => e.is_active)
    if (deptFilter !== 'all') emps = emps.filter(e => e.department_id === parseInt(deptFilter))

    return emps.map(emp => {
      const empRecords = records.filter(r => r.employee_id === emp.id && r.status === 'present')
      const daysWorked = empRecords.length
      const totalWorkHours = empRecords.reduce((sum, r) => sum + (parseFloat(String(r.work_hours)) || 0), 0)
      const totalOvertime = empRecords.reduce((sum, r) => sum + (parseFloat(String(r.overtime_hours)) || 0), 0)
      const avgWorkHours = daysWorked > 0 ? totalWorkHours / daysWorked : 0

      return {
        id: emp.id,
        name: emp.name,
        department: emp.department?.name || '',
        daysWorked,
        totalWorkHours: Math.round(totalWorkHours * 100) / 100,
        totalOvertime: Math.round(totalOvertime * 100) / 100,
        avgWorkHours: Math.round(avgWorkHours * 100) / 100,
      }
    }).sort((a, b) => b.totalOvertime - a.totalOvertime)
  }, [employees, records, deptFilter])

  const grandTotalWork = reportData.reduce((s, r) => s + r.totalWorkHours, 0)
  const grandTotalOT = reportData.reduce((s, r) => s + r.totalOvertime, 0)
  const employeesWithOT = reportData.filter(r => r.totalOvertime > 0).length

  function handleExport() {
    const data = reportData.map(r => ({
      [lang === 'ar' ? 'الاسم' : 'Name']: r.name,
      [lang === 'ar' ? 'القسم' : 'Department']: r.department,
      [lang === 'ar' ? 'أيام العمل' : 'Days Worked']: r.daysWorked,
      [lang === 'ar' ? 'ساعات العمل' : 'Work Hours']: r.totalWorkHours,
      [lang === 'ar' ? 'ساعات إضافية' : 'Overtime Hours']: r.totalOvertime,
      [lang === 'ar' ? 'المعدل اليومي' : 'Avg Daily Hours']: r.avgWorkHours,
    }))
    exportToExcel(data, `overtime-report-${monthKey}`, lang === 'ar' ? 'تقرير الإضافي' : 'Overtime Report')
  }

  function handlePrint() {
    window.print()
  }

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{lang === 'ar' ? 'تقرير ساعات العمل والإضافي' : 'Work Hours & Overtime Report'}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1.5" />
            {t('exportExcel')}
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1.5" />
            {t('print')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(parseInt(v))}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[2025, 2026, 2027].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(parseInt(v))}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthNames.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={deptFilter} onValueChange={v => setDeptFilter(v ?? 'all')}>
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

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Clock className="h-4 w-4 text-blue-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'إجمالي ساعات العمل' : 'Total Work Hours'}</p>
              <p className="text-xl font-bold">{Math.round(grandTotalWork * 10) / 10}h</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10"><TrendingUp className="h-4 w-4 text-amber-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'إجمالي الإضافي' : 'Total Overtime'}</p>
              <p className="text-xl font-bold text-amber-500">{Math.round(grandTotalOT * 10) / 10}h</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10"><Users className="h-4 w-4 text-emerald-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'موظفين لديهم إضافي' : 'Employees with OT'}</p>
              <p className="text-xl font-bold text-emerald-500">{employeesWithOT}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t('name')}</TableHead>
                  <TableHead className="text-center">{t('department')}</TableHead>
                  <TableHead className="text-center">{lang === 'ar' ? 'أيام العمل' : 'Days'}</TableHead>
                  <TableHead className="text-center">{t('workHours')}</TableHead>
                  <TableHead className="text-center">{t('overtime')}</TableHead>
                  <TableHead className="text-center">{lang === 'ar' ? 'المعدل اليومي' : 'Avg/Day'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('noData')}</TableCell>
                  </TableRow>
                ) : (
                  reportData.map(emp => (
                    <TableRow key={emp.id}>
                      <TableCell className="font-medium">{emp.name}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">{emp.department}</Badge>
                      </TableCell>
                      <TableCell className="text-center">{emp.daysWorked}</TableCell>
                      <TableCell className="text-center font-mono">{emp.totalWorkHours}h</TableCell>
                      <TableCell className="text-center">
                        {emp.totalOvertime > 0 ? (
                          <span className="text-amber-500 font-mono font-semibold">+{emp.totalOvertime}h</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono">{emp.avgWorkHours}h</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
