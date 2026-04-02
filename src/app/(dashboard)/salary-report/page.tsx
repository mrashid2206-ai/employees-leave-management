'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Download, Printer } from 'lucide-react'
import { getEmployees, getLeaveRequests, getTardinessRecords, getSettings, getDepartments, getLeaveTypes } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'
import { exportToExcel } from '@/lib/excel'

function formatMinutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function SalaryReportPage() {
  const t = useT()
  const { lang, dir } = useLanguage()
  const [deptFilter, setDeptFilter] = useState<string>('all')

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })

  const reportData = useMemo(() => {
    let emps = employees.filter(e => e.is_active)
    if (deptFilter !== 'all') emps = emps.filter(e => e.department_id === parseInt(deptFilter))

    return emps.map(emp => {
      const empTardiness = tardiness.filter(t => t.employee_id === emp.id)
      const totalMinutes = empTardiness.reduce((sum, t) => sum + t.minutes_late, 0)
      const totalHours = Math.round(totalMinutes / 60 * 100) / 100
      const deductionRate = settings?.deduction_per_hour || 0
      const deduction = Math.round(totalHours * deductionRate * 1000) / 1000
      const tardCount = empTardiness.length

      const empLeaves = leaves.filter(l => l.employee_id === emp.id && l.status === 'approved')
      const unpaidTypeId = leaveTypes.find(lt => lt.name_en === 'Unpaid')?.id
      const unpaidDays = empLeaves.filter(l => unpaidTypeId && l.leave_type_id === unpaidTypeId).reduce((sum, l) => sum + l.days_count, 0)

      return {
        id: emp.id,
        name: emp.name,
        department: emp.department?.name || '',
        tardCount,
        totalMinutes,
        totalHours,
        deductionRate,
        deduction,
        unpaidDays,
        totalImpact: deduction,
      }
    }).sort((a, b) => b.deduction - a.deduction)
  }, [employees, tardiness, leaves, settings, deptFilter, leaveTypes])

  const totalDeductions = reportData.reduce((sum, r) => sum + r.deduction, 0)

  function handleExportExcel() {
    const data = reportData.map(r => ({
      [t('name')]: r.name,
      [t('department')]: r.department,
      [lang === 'ar' ? 'عدد مرات التأخير' : 'Late Count']: r.tardCount,
      [lang === 'ar' ? 'إجمالي الدقائق' : 'Total Minutes']: r.totalMinutes,
      [lang === 'ar' ? 'إجمالي الساعات' : 'Total Hours']: r.totalHours,
      [lang === 'ar' ? 'سعر الساعة' : 'Rate/Hour']: r.deductionRate,
      [t('totalDeduction') + ` (${settings?.currency || 'OMR'})`]: r.deduction,
    }))
    exportToExcel(data, 'salary_deduction_report', lang === 'ar' ? 'تقرير الخصومات' : 'Deduction Report')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t('salaryReport')}</h1>
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
          <Button variant="outline" onClick={handleExportExcel}>
            <Download className="h-4 w-4 ml-2" />
            {t('exportExcel')}
          </Button>
          <Button variant="outline" onClick={() => window.print()} className="no-print">
            <Printer className="h-4 w-4 ml-2" />
            {t('print')}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-0 shadow-lg">
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('totalDeduction')}</p>
            <p className="text-2xl font-bold text-rose-500 mt-1">{totalDeductions.toFixed(3)} {settings?.currency_symbol}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg">
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{lang === 'ar' ? 'الموظفين المتأثرين' : 'Affected Employees'}</p>
            <p className="text-2xl font-bold text-amber-500 mt-1">{reportData.filter(r => r.deduction > 0).length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg">
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{lang === 'ar' ? 'سعر الخصم/ساعة' : 'Deduction Rate/Hour'}</p>
            <p className="text-2xl font-bold mt-1">{settings?.deduction_per_hour || 0} {settings?.currency_symbol}</p>
          </CardContent>
        </Card>
      </div>

      {/* Report Table */}
      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-12">#</TableHead>
                  <TableHead className="text-start">{t('name')}</TableHead>
                  <TableHead className="text-center">{t('department')}</TableHead>
                  <TableHead className="text-center">{t('lateCount')}</TableHead>
                  <TableHead className="text-center">{lang === 'ar' ? 'الدقائق' : 'Minutes'}</TableHead>
                  <TableHead className="text-center">{lang === 'ar' ? 'الساعات' : 'Hours'}</TableHead>
                  <TableHead className="text-center">{t('deduction')} ({settings?.currency || 'OMR'})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((row, idx) => (
                  <TableRow key={row.id} className={row.deduction > 0 ? '' : 'opacity-50'}>
                    <TableCell className="text-center">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-center">{row.department}</TableCell>
                    <TableCell className="text-center">{row.tardCount}</TableCell>
                    <TableCell className="text-center font-mono">{row.totalMinutes}</TableCell>
                    <TableCell className="text-center font-mono">{row.totalHours}</TableCell>
                    <TableCell className="text-center">
                      {row.deduction > 0 ? (
                        <span className="font-mono font-bold text-rose-500">{row.deduction.toFixed(3)}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={3} className="text-start">{t('total')}</TableCell>
                  <TableCell className="text-center">{reportData.reduce((s, r) => s + r.tardCount, 0)}</TableCell>
                  <TableCell className="text-center font-mono">{reportData.reduce((s, r) => s + r.totalMinutes, 0)}</TableCell>
                  <TableCell className="text-center font-mono">{Math.round(reportData.reduce((s, r) => s + r.totalHours, 0) * 100) / 100}</TableCell>
                  <TableCell className="text-center font-mono text-rose-500">{totalDeductions.toFixed(3)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
