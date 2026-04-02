'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Download, Printer, FileSpreadsheet } from 'lucide-react'
import { exportToExcel } from '@/lib/excel'
import { useLanguage, useT } from '@/lib/language-context'
import { getEmployees, getLeaveRequests, getTardinessRecords, getSettings, getDepartments, getLeaveTypes } from '@/lib/api'

function formatMinutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const MONTHS_AR = ['مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير']
const MONTHS_EN = ['March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February']

export default function ReportsPage() {
  const t = useT()
  const { dir, lang } = useLanguage()
  const MONTHS = lang === 'ar' ? MONTHS_AR : MONTHS_EN
  const [deptFilter, setDeptFilter] = useState<string>('all')

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })

  const filteredEmployees = useMemo(() => {
    let emps = employees.filter(e => e.is_active)
    if (deptFilter !== 'all') {
      emps = emps.filter(e => e.department_id === parseInt(deptFilter))
    }
    return emps
  }, [employees, deptFilter])

  // Employee summary data
  const summaryData = useMemo(() => {
    return filteredEmployees.map(emp => {
      const empLeaves = leaves.filter(l => l.employee_id === emp.id && l.status === 'approved')
      const usedDays = empLeaves.reduce((sum, l) => sum + l.days_count, 0)
      const empTardiness = tardiness.filter(t => t.employee_id === emp.id)
      const tardMinutes = empTardiness.reduce((sum, t) => sum + t.minutes_late, 0)
      const tardDays = settings ? tardMinutes / 60 / settings.work_hours_per_day : 0
      const remaining = emp.leave_balance
      const deduction = settings ? Math.round(tardMinutes / 60 * settings.deduction_per_hour * 1000) / 1000 : 0

      // By type breakdown
      const byType: Record<string, number> = {}
      leaveTypes.forEach(lt => {
        byType[lt.name_en] = empLeaves
          .filter(l => l.leave_type_id === lt.id)
          .reduce((sum, l) => sum + l.days_count, 0)
      })

      return {
        id: emp.id,
        name: emp.name,
        department: emp.department?.name || '',
        balance: emp.leave_balance,
        usedDays,
        byType,
        tardMinutes,
        remaining,
        deduction,
      }
    })
  }, [filteredEmployees, leaves, tardiness, settings, leaveTypes])

  // Monthly leave calendar
  const monthlyData = useMemo(() => {
    return filteredEmployees.map(emp => {
      const empLeaves = leaves.filter(l => l.employee_id === emp.id && l.status === 'approved')
      const months: number[] = Array(12).fill(0)

      empLeaves.forEach(leave => {
        const start = new Date(leave.start_date)
        const end = new Date(leave.end_date)
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const month = d.getMonth()
          // Map calendar month to fiscal year index (March=0, ..., February=11)
          const fiscalIdx = month >= 2 ? month - 2 : month + 10
          months[fiscalIdx]++
        }
      })

      return {
        name: emp.name,
        department: emp.department?.name || '',
        months,
        total: months.reduce((s, m) => s + m, 0),
      }
    })
  }, [filteredEmployees, leaves])

  function exportCSV() {
    const headers = [t('name'), t('department'), t('balance'), t('used'), ...leaveTypes.map(lt => lang === 'ar' ? lt.name_ar : lt.name_en), t('remaining'), t('tardinessHHMM') + ' (' + t('minutes') + ')', t('deduction')]
    const rows = summaryData.map(emp => [
      emp.name,
      emp.department,
      emp.balance,
      emp.usedDays,
      ...leaveTypes.map(lt => emp.byType[lt.name_en] || 0),
      emp.remaining,
      emp.tardMinutes,
      emp.deduction,
    ])

    const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n')
    const BOM = '\uFEFF'
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'leave_report.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t('reports')}</h1>
        <div className="flex gap-3">
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
          <Button variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 ml-2" />
            {t('exportCSV')}
          </Button>
          <Button variant="outline" onClick={() => {
            const data = summaryData.map(emp => ({
              [t('name')]: emp.name,
              [t('department')]: emp.department,
              [t('balance')]: emp.balance,
              [t('used')]: emp.usedDays,
              [t('remaining')]: emp.remaining,
              [t('tardinessHHMM') + ' (' + t('minutes') + ')']: emp.tardMinutes,
              [t('deduction')]: emp.deduction,
            }))
            exportToExcel(data, 'leave_report', lang === 'ar' ? 'تقرير الإجازات' : 'Leave Report')
          }}>
            <FileSpreadsheet className="h-4 w-4 ml-2" />
            {t('exportExcel')}
          </Button>
          <Button variant="outline" onClick={() => window.print()} className="no-print">
            <Printer className="h-4 w-4 ml-2" />
            {t('print')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="summary" dir={dir}>
        <TabsList>
          <TabsTrigger value="summary">{t('leaveSummary')}</TabsTrigger>
          <TabsTrigger value="calendar">{t('monthlyCalendar')}</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">{t('name')}</TableHead>
                      <TableHead className="text-center">{t('department')}</TableHead>
                      <TableHead className="text-center">{t('balance')}</TableHead>
                      <TableHead className="text-center">{t('used')}</TableHead>
                      {leaveTypes.map(lt => (
                        <TableHead key={lt.id} className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: lt.color }} />
                            {lang === 'ar' ? lt.name_ar : lt.name_en}
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="text-center">{t('remaining')}</TableHead>
                      <TableHead className="text-center">{t('tardinessHHMM')}</TableHead>
                      <TableHead className="text-center">{t('deduction')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryData.map(emp => (
                      <TableRow key={emp.id}>
                        <TableCell className="font-medium">{emp.name}</TableCell>
                        <TableCell className="text-center">{emp.department}</TableCell>
                        <TableCell className="text-center">{emp.balance}</TableCell>
                        <TableCell className="text-center">{emp.usedDays}</TableCell>
                        {leaveTypes.map(lt => (
                          <TableCell key={lt.id} className="text-center">
                            {emp.byType[lt.name_en] || 0}
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-bold">
                          <span className={emp.remaining < 5 ? 'text-[#F44336]' : 'text-[#4CAF50]'}>
                            {emp.remaining}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">{formatMinutesToHHMM(emp.tardMinutes)}</TableCell>
                        <TableCell className="text-center">{emp.deduction.toFixed(3)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start sticky right-0 bg-card z-10">{t('name')}</TableHead>
                      {MONTHS.map((m, i) => (
                        <TableHead key={i} className="text-center text-xs min-w-[50px]">{m}</TableHead>
                      ))}
                      <TableHead className="text-center font-bold">{t('total')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyData.map(emp => (
                      <TableRow key={emp.name}>
                        <TableCell className="font-medium sticky right-0 bg-card z-10">{emp.name}</TableCell>
                        {emp.months.map((days, i) => (
                          <TableCell key={i} className="text-center">
                            {days > 0 ? (
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#1976D2]/10 text-[#1976D2] text-xs font-bold">
                                {days}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-bold">{emp.total}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
