'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Download, Printer, MapPin, Users, LogIn, LogOut } from 'lucide-react'
import { getEmployees, getDepartments } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'
import { exportToExcel } from '@/lib/excel'

// The geofence records but never blocks (laptops and desktops have no GPS, so blocking
// locked people out). This report is the other half of that decision: everything is
// allowed through, and off-site activity surfaces here for a human to review.

interface AttendanceRecord {
  id: number
  employee_id: number
  date: string
  check_in: string | null
  check_out: string | null
  status: string
  is_offsite?: boolean
  is_offsite_checkout?: boolean
  check_in_ip?: string | null
  check_out_ip?: string | null
  check_in_lat?: string | number | null
  check_in_lng?: string | number | null
  check_out_lat?: string | number | null
  check_out_lng?: string | number | null
  employee?: { id: number; name: string; department_id: number }
}

type EventKind = 'in' | 'out'

interface OffsiteEvent {
  key: string
  employeeId: number
  name: string
  department: string
  date: string
  time: string | null
  kind: EventKind
  ip: string | null
  lat: number | null
  lng: number | null
}

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

export default function OffsiteReportPage() {
  const t = useT()
  const { lang, dir } = useLanguage()
  const [deptFilter, setDeptFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')

  const now = new Date()
  const currentYear = now.getFullYear()
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1]
  const [selectedYear, setSelectedYear] = useState(currentYear)
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)

  const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: allRecords = [] } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-offsite', monthKey],
    queryFn: () => fetch(`/api/attendance?month=${monthKey}`).then(r => r.json()),
  })

  const monthNames = lang === 'ar'
    ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const deptById = useMemo(
    () => new Map(employees.map(e => [e.id, e.department?.name || ''])),
    [employees]
  )
  const deptIdByEmployee = useMemo(
    () => new Map(employees.map(e => [e.id, e.department_id])),
    [employees]
  )

  // One attendance row can hold TWO off-site events (checked in remotely and checked out
  // remotely), so flatten to one row per event rather than per day.
  const events = useMemo<OffsiteEvent[]>(() => {
    const out: OffsiteEvent[] = []
    for (const r of allRecords) {
      const name = r.employee?.name || ''
      const department = deptById.get(r.employee_id) || ''
      if (r.is_offsite) {
        out.push({
          key: `${r.id}-in`, employeeId: r.employee_id, name, department,
          date: r.date, time: r.check_in, kind: 'in',
          ip: r.check_in_ip ?? null, lat: num(r.check_in_lat), lng: num(r.check_in_lng),
        })
      }
      if (r.is_offsite_checkout) {
        out.push({
          key: `${r.id}-out`, employeeId: r.employee_id, name, department,
          date: r.date, time: r.check_out, kind: 'out',
          ip: r.check_out_ip ?? null, lat: num(r.check_out_lat), lng: num(r.check_out_lng),
        })
      }
    }
    return out.sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')))
  }, [allRecords, deptById])

  const filtered = useMemo(() => {
    return events.filter(e => {
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false
      if (deptFilter !== 'all' && String(deptIdByEmployee.get(e.employeeId)) !== deptFilter) return false
      return true
    })
  }, [events, kindFilter, deptFilter, deptIdByEmployee])

  const checkInEvents = filtered.filter(e => e.kind === 'in').length
  const checkOutEvents = filtered.filter(e => e.kind === 'out').length
  const peopleAffected = new Set(filtered.map(e => e.employeeId)).size

  // Denominator is check-ins actually recorded this month, so the rate answers
  // "how often did people start their day away from the office?"
  const totalCheckIns = allRecords.filter(r => r.check_in).length
  const offsiteRate = totalCheckIns > 0
    ? Math.round((events.filter(e => e.kind === 'in').length / totalCheckIns) * 1000) / 10
    : 0

  function handleExport() {
    const data = filtered.map(e => ({
      [t('name')]: e.name,
      [t('department')]: e.department,
      [t('date')]: e.date,
      [t('time')]: e.time || '',
      [t('eventType')]: e.kind === 'in' ? t('checkIn') : t('checkOut'),
      [t('ipAddress')]: e.ip || '',
      [t('coordinates')]: e.lat !== null && e.lng !== null ? `${e.lat}, ${e.lng}` : '',
    }))
    exportToExcel(data, `offsite-report-${monthKey}`, t('offsiteReport'))
  }

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('offsiteReport')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('offsiteReportHint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1.5" />
            {t('exportExcel')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" />
            {t('print')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(parseInt(v ?? String(currentYear)))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(parseInt(v ?? '1'))}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {monthNames.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={kindFilter} onValueChange={v => setKindFilter(v ?? 'all')}>
          <SelectTrigger className="w-40"><SelectValue placeholder={t('allTypes')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allTypes')}</SelectItem>
            <SelectItem value="in">{t('checkIn')}</SelectItem>
            <SelectItem value="out">{t('checkOut')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={deptFilter} onValueChange={v => setDeptFilter(v ?? 'all')}>
          <SelectTrigger className="w-40"><SelectValue placeholder={t('allDepts')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allDepts')}</SelectItem>
            {departments.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10"><LogIn className="h-4 w-4 text-amber-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('offsiteCheckIns')}</p>
              <p className="text-xl font-bold text-amber-500">{checkInEvents}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10"><LogOut className="h-4 w-4 text-purple-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('offsiteCheckOuts')}</p>
              <p className="text-xl font-bold text-purple-500">{checkOutEvents}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Users className="h-4 w-4 text-blue-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('employeesAffected')}</p>
              <p className="text-xl font-bold">{peopleAffected}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10"><MapPin className="h-4 w-4 text-emerald-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('offsiteRate')}</p>
              <p className="text-xl font-bold">{offsiteRate}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t('name')}</TableHead>
                  <TableHead className="text-center">{t('department')}</TableHead>
                  <TableHead className="text-center">{t('date')}</TableHead>
                  <TableHead className="text-center">{t('time')}</TableHead>
                  <TableHead className="text-center">{t('eventType')}</TableHead>
                  <TableHead className="text-center">{t('ipAddress')}</TableHead>
                  <TableHead className="text-center">{t('location')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('noOffsiteActivity')}</TableCell>
                  </TableRow>
                ) : (
                  filtered.map(e => (
                    <TableRow key={e.key}>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">{e.department}</Badge>
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">{e.date}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{e.time?.slice(0, 5) || '-'}</TableCell>
                      <TableCell className="text-center">
                        {e.kind === 'in' ? (
                          <Badge className="bg-amber-500/10 text-amber-500 border-0 text-xs">{t('checkIn')}</Badge>
                        ) : (
                          <Badge className="bg-purple-500/10 text-purple-500 border-0 text-xs">{t('checkOut')}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">{e.ip || '-'}</TableCell>
                      <TableCell className="text-center">
                        {e.lat !== null && e.lng !== null ? (
                          <a
                            className="text-primary hover:underline text-xs inline-flex items-center gap-1"
                            href={`https://www.google.com/maps?q=${e.lat},${e.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <MapPin className="h-3 w-3" />
                            {t('viewOnMap')}
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs">{t('noGpsFix')}</span>
                        )}
                      </TableCell>
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
