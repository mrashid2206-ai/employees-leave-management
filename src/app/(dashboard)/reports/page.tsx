'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Download, Printer, FileSpreadsheet } from 'lucide-react'
import { exportToExcel } from '@/lib/excel'
import { useLanguage, useT } from '@/lib/language-context'
import { getEmployees, getLeaveRequests, getTardinessRecords, getDepartments, getLeaveTypes, getHolidays } from '@/lib/api'
import { inLeaveYear, leaveYearMonths, MONTH_NAMES } from '@/lib/leave-year'
import { useLeaveYear, LeaveYearSelect } from '@/components/leave-year-select'

function formatMinutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// One CSV cell. Quote it if it holds a comma, quote or line break, so a name like
// "Al Said, Ahmed" doesn't shift every column after it.
function csvCell(value: unknown): string {
  const s = String(value ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function ReportsPage() {
  const t = useT()
  const { dir, lang } = useLanguage()
  const [deptFilter, setDeptFilter] = useState<string>('all')
  const { years, year, index: yearIndex, setIndex: setYearIndex } = useLeaveYear()

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })
  const { data: holidays = [] } = useQuery({ queryKey: ['holidays'], queryFn: getHolidays })

  // One leave year at a time. Balances reset each year, so totals across years can't be
  // read against the balance next to them.
  const yearLeaves = useMemo(
    () => (year ? leaves.filter(l => l.status === 'approved' && inLeaveYear(l.start_date, year)) : []),
    [leaves, year]
  )
  const yearTardiness = useMemo(
    () => (year ? tardiness.filter(t => inLeaveYear(t.date, year)) : []),
    [tardiness, year]
  )
  // The balance is today's figure, so it only belongs next to the current year's usage.
  const showBalance = !!year?.isCurrent
  const months = useMemo(() => (year ? leaveYearMonths(year) : []), [year])

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
      const empLeaves = yearLeaves.filter(l => l.employee_id === emp.id)
      const usedDays = empLeaves.reduce((sum, l) => sum + Number(l.days_count), 0)
      const empTardiness = yearTardiness.filter(t => t.employee_id === emp.id)
      const tardMinutes = empTardiness.reduce((sum, t) => sum + t.minutes_late, 0)
      const remaining = emp.leave_balance

      // By type breakdown
      const byType: Record<string, number> = {}
      leaveTypes.forEach(lt => {
        byType[lt.name_en] = empLeaves
          .filter(l => l.leave_type_id === lt.id)
          .reduce((sum, l) => sum + Number(l.days_count), 0)
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
      }
    })
  }, [filteredEmployees, yearLeaves, yearTardiness, leaveTypes])

  // Monthly leave calendar — exclude public holidays so per-month totals reconcile with
  // the Summary tab's used days (days_count is already holiday-adjusted server-side).
  const holidaySet = useMemo(() => new Set(holidays.map(h => h.date)), [holidays])
  const monthlyData = useMemo(() => {
    return filteredEmployees.map(emp => {
      const empLeaves = yearLeaves.filter(l => l.employee_id === emp.id)
      const counts: number[] = Array(months.length).fill(0)

      empLeaves.forEach(leave => {
        const [sy, sm, sd] = leave.start_date.split('-').map(Number)
        const [ey, em, ed] = leave.end_date.split('-').map(Number)
        const startMs = Date.UTC(sy, sm - 1, sd)
        const endMs = Date.UTC(ey, em - 1, ed)
        for (let ms = startMs; ms <= endMs; ms += 86400000) {
          const d = new Date(ms)
          const iso = d.toISOString().split('T')[0]
          if (holidaySet.has(iso)) continue // holidays are not counted as leave
          // Weekends are counted (company policy)
          const idx = months.findIndex(m => m.year === d.getUTCFullYear() && m.month === d.getUTCMonth())
          if (idx >= 0) counts[idx]++
        }
      })

      return {
        name: emp.name,
        department: emp.department?.name || '',
        months: counts,
        total: counts.reduce((s, m) => s + m, 0),
      }
    })
  }, [filteredEmployees, yearLeaves, holidaySet, months])

  function exportCSV() {
    const dedupedTypes = leaveTypes.filter((lt, i, arr) => arr.findIndex(t => t.name_en === lt.name_en) === i)
    const headers = [t('name'), t('department'), t('balance'), t('used'), ...dedupedTypes.map(lt => lang === 'ar' ? lt.name_ar : lt.name_en), t('remaining'), t('tardinessHHMM') + ' (' + t('minutes') + ')']
    const rows = summaryData.map(emp => [
      emp.name,
      emp.department,
      showBalance ? emp.balance : '',
      emp.usedDays,
      ...dedupedTypes.map(lt => emp.byType[lt.name_en] || 0),
      showBalance ? emp.remaining : '',
      emp.tardMinutes,
    ])

    const csvContent = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n')
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
        <div className="flex gap-3 flex-wrap">
          <LeaveYearSelect years={years} index={yearIndex} onChange={setYearIndex} />
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
              [t('balance')]: showBalance ? emp.balance : '',
              [t('used')]: emp.usedDays,
              [t('remaining')]: showBalance ? emp.remaining : '',
              [t('tardinessHHMM') + ' (' + t('minutes') + ')']: emp.tardMinutes,
            }))
            exportToExcel(data, 'leave_report', t('leaveReport'))
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
                      {leaveTypes.filter((lt, i, arr) => arr.findIndex(t => t.name_en === lt.name_en) === i).map(lt => (
                        <TableHead key={lt.id} className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: lt.color }} />
                            {lang === 'ar' ? lt.name_ar : lt.name_en}
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="text-center">{t('remaining')}</TableHead>
                      <TableHead className="text-center">{t('tardinessHHMM')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryData.map(emp => (
                      <TableRow key={emp.id}>
                        <TableCell className="font-medium">{emp.name}</TableCell>
                        <TableCell className="text-center">{emp.department}</TableCell>
                        <TableCell className="text-center">{showBalance ? emp.balance : '—'}</TableCell>
                        <TableCell className="text-center">{emp.usedDays}</TableCell>
                        {leaveTypes.filter((lt, i, arr) => arr.findIndex(t => t.name_en === lt.name_en) === i).map(lt => (
                          <TableCell key={lt.id} className="text-center">
                            {emp.byType[lt.name_en] || 0}
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-bold">
                          {showBalance ? (
                            <span className={emp.remaining < 5 ? 'text-[#F44336]' : 'text-[#4CAF50]'}>
                              {emp.remaining}
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-center">{formatMinutesToHHMM(emp.tardMinutes)}</TableCell>
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
                      {months.map(m => (
                        <TableHead key={`${m.year}-${m.month}`} className="text-center text-xs min-w-[50px]">
                          {MONTH_NAMES[lang === 'ar' ? 'ar' : 'en'][m.month]}
                        </TableHead>
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
