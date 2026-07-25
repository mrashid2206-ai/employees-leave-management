'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Download, Printer } from 'lucide-react'
import { getEmployees, getTardinessRecords, getDepartments } from '@/lib/api'
import { useT } from '@/lib/language-context'
import { exportToExcel } from '@/lib/excel'

function formatMinutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function TardinessSummaryPage() {
  const t = useT()
  const [deptFilter, setDeptFilter] = useState<string>('all')

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })

  const reportData = useMemo(() => {
    let emps = employees.filter(e => e.is_active)
    if (deptFilter !== 'all') emps = emps.filter(e => e.department_id === parseInt(deptFilter))

    return emps.map(emp => {
      const empTardiness = tardiness.filter(t => t.employee_id === emp.id)
      const totalMinutes = empTardiness.reduce((sum, t) => sum + t.minutes_late, 0)
      const tardCount = empTardiness.length
      return {
        id: emp.id,
        name: emp.name,
        department: emp.department?.name || '',
        tardCount,
        totalMinutes,
      }
    }).sort((a, b) => b.totalMinutes - a.totalMinutes)
  }, [employees, tardiness, deptFilter])

  const totalLateCount = reportData.reduce((s, r) => s + r.tardCount, 0)
  const totalMinutes = reportData.reduce((s, r) => s + r.totalMinutes, 0)
  const affected = reportData.filter(r => r.tardCount > 0).length

  function handleExportExcel() {
    const data = reportData.map(r => ({
      [t('name')]: r.name,
      [t('department')]: r.department,
      [t('lateCount')]: r.tardCount,
      [t('totalMinutes')]: r.totalMinutes,
      [t('tardinessHHMM')]: formatMinutesToHHMM(r.totalMinutes),
    }))
    exportToExcel(data, 'tardiness_summary', t('tardinessSummary'))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t('tardinessSummary')}</h1>
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
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('totalLate')}</p>
            <p className="text-2xl font-bold text-amber-500 mt-1">{formatMinutesToHHMM(totalMinutes)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg">
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('lateCount')}</p>
            <p className="text-2xl font-bold mt-1">{totalLateCount}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg">
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('affectedEmployees')}</p>
            <p className="text-2xl font-bold text-rose-500 mt-1">{affected}</p>
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
                  <TableHead className="text-center">{t('minutes2')}</TableHead>
                  <TableHead className="text-center">{t('tardinessHHMM')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((row, idx) => (
                  <TableRow key={row.id} className={row.tardCount > 0 ? '' : 'opacity-50'}>
                    <TableCell className="text-center">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-center">{row.department}</TableCell>
                    <TableCell className="text-center">{row.tardCount}</TableCell>
                    <TableCell className="text-center font-mono">{row.totalMinutes}</TableCell>
                    <TableCell className="text-center font-mono">
                      {row.totalMinutes > 0 ? (
                        <span className="font-bold text-amber-500">{formatMinutesToHHMM(row.totalMinutes)}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={3} className="text-start">{t('total')}</TableCell>
                  <TableCell className="text-center">{totalLateCount}</TableCell>
                  <TableCell className="text-center font-mono">{totalMinutes}</TableCell>
                  <TableCell className="text-center font-mono text-amber-500">{formatMinutesToHHMM(totalMinutes)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
