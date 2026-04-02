'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChevronRight, ChevronLeft, UserCheck, UserX, Clock, Plus, Pencil, Trash2, ShieldCheck, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { getEmployees, getDepartments, getSettings, getLeaveRequests } from '@/lib/api'
import { exportToExcel } from '@/lib/excel'
import { useLanguage, useT } from '@/lib/language-context'

const DAY_NAMES_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface AttendanceRecord {
  id: number
  employee_id: number
  date: string
  check_in: string | null
  check_out: string | null
  work_hours: number
  overtime_hours: number
  status: string
  notes: string | null
  is_holiday_work: boolean
  excused_tardiness: boolean
  is_offsite?: boolean
  check_in_ip?: string
  employee?: { id: number; name: string; department_id: number }
}

export default function AttendancePage() {
  const queryClient = useQueryClient()
  const t = useT()
  const { lang, dir } = useLanguage()

  const now = new Date()
  const [currentDate, setCurrentDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [deptFilter, setDeptFilter] = useState<string>('all')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedEmployees, setSelectedEmployees] = useState<number[]>([])
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null)
  const [dayDetailOpen, setDayDetailOpen] = useState(false)
  const [form, setForm] = useState({
    check_in: '08:00',
    check_out: '16:00',
    status: 'present',
  })

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const selectedMonth = `${year}-${String(month + 1).padStart(2, '0')}`
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const dayNames = lang === 'ar' ? DAY_NAMES_AR : DAY_NAMES_EN

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: records = [] } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance', selectedMonth],
    queryFn: () => fetch(`/api/attendance?month=${selectedMonth}`).then(r => r.json()),
  })

  const createMutation = useMutation({
    mutationFn: (data: any[]) => fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      setDialogOpen(false)
      setSelectedEmployees([])
      toast.success(t('addedSuccess'))
    },
    onError: () => toast.error(t('error')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/attendance/${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      toast.success(t('deletedSuccess'))
    },
  })

  const toggleExcusedMutation = useMutation({
    mutationFn: ({ id, excused }: { id: number; excused: boolean }) =>
      fetch(`/api/attendance/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excused_tardiness: excused }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
    },
  })

  const filteredEmployees = useMemo(() => {
    let emps = employees.filter(e => e.is_active)
    if (deptFilter !== 'all') emps = emps.filter(e => e.department_id === parseInt(deptFilter))
    return emps
  }, [employees, deptFilter])

  // Build calendar data per day
  const calendarData = useMemo(() => {
    const days: Record<number, { present: number; absent: number; records: AttendanceRecord[] }> = {}
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const dayRecords = records.filter(r => r.date === dateStr)
      days[d] = {
        present: dayRecords.filter(r => r.status === 'present').length,
        absent: dayRecords.filter(r => r.status === 'absent').length,
        records: dayRecords,
      }
    }
    return days
  }, [records, year, month, daysInMonth])

  // Monthly summary per employee
  const monthlyStats = useMemo(() => {
    return filteredEmployees.map(emp => {
      const empRecords = records.filter(r => r.employee_id === emp.id)
      const presentDays = empRecords.filter(r => r.status === 'present').length
      const absentDays = empRecords.filter(r => r.status === 'absent').length
      const holidayDays = empRecords.filter(r => r.is_holiday_work).length
      const totalWorkHours = empRecords.reduce((sum, r) => sum + (parseFloat(String(r.work_hours)) || 0), 0)
      const totalOvertime = empRecords.reduce((sum, r) => sum + (parseFloat(String(r.overtime_hours)) || 0), 0)
      return {
        ...emp,
        presentDays,
        absentDays,
        holidayDays,
        totalWorkHours: Math.round(totalWorkHours * 10) / 10,
        totalOvertime: Math.round(totalOvertime * 10) / 10,
      }
    })
  }, [filteredEmployees, records])

  const today = new Date()
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
  const workDays = (settings?.work_days || '0,1,2,3,4').split(',').map(Number)
  const isWeekend = (day: number) => {
    const d = new Date(year, month, day).getDay()
    return !workDays.includes(d)
  }

  function openDayDialog(day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    setSelectedDay(dateStr)
    setDialogOpen(true)
    setSelectedEmployees([])
    setForm({ check_in: '08:00', check_out: '16:00', status: 'present' })
    setEditRecord(null)
  }

  function handleSubmit() {
    if (editRecord) {
      // Edit existing record
      const data = [{
        employee_id: editRecord.employee_id,
        date: editRecord.date,
        check_in: form.check_in,
        check_out: form.check_out,
        status: 'present',
      }]
      createMutation.mutate(data)
      setEditRecord(null)
      return
    }
    if (!selectedDay || selectedEmployees.length === 0) {
      toast.error(t('fillRequired'))
      return
    }
    const data = selectedEmployees.map(empId => ({
      employee_id: empId,
      date: selectedDay,
      check_in: form.check_in,
      check_out: form.check_out,
      status: 'present',
    }))
    createMutation.mutate(data)
  }

  function toggleEmployee(empId: number) {
    setSelectedEmployees(prev =>
      prev.includes(empId) ? prev.filter(id => id !== empId) : [...prev, empId]
    )
  }

  function selectAllEmployees() {
    const allIds = filteredEmployees.map(e => e.id)
    setSelectedEmployees(prev => prev.length === allIds.length ? [] : allIds)
  }

  function handleExportAttendance() {
    const data = monthlyStats.map(emp => ({
      [lang === 'ar' ? 'الاسم' : 'Name']: emp.name,
      [lang === 'ar' ? 'حاضر' : 'Present Days']: emp.presentDays,
      [lang === 'ar' ? 'غائب' : 'Absent Days']: emp.absentDays,
      [lang === 'ar' ? 'عمل عطلة' : 'Holiday Work']: emp.holidayDays,
      [lang === 'ar' ? 'ساعات العمل' : 'Work Hours']: emp.totalWorkHours,
      [lang === 'ar' ? 'ساعات إضافية' : 'Overtime Hours']: emp.totalOvertime,
    }))
    exportToExcel(data, `attendance-${selectedMonth}`, lang === 'ar' ? 'الحضور' : 'Attendance')
  }

  // Grid cells
  const gridCells: (number | null)[] = []
  for (let i = 0; i < firstDayOfWeek; i++) gridCells.push(null)
  for (let d = 1; d <= daysInMonth; d++) gridCells.push(d)

  // Day detail records
  const dayDetailRecords = selectedDay ? records.filter(r => r.date === selectedDay) : []

  const monthLabel = currentDate.toLocaleDateString(lang === 'ar' ? 'ar-OM' : 'en-US', { year: 'numeric', month: 'long' })

  // KPIs for the month
  const totalPresent = Object.values(calendarData).reduce((s, d) => s + d.present, 0)
  const totalAbsent = Object.values(calendarData).reduce((s, d) => s + d.absent, 0)
  const totalWorkHours = records.reduce((s, r) => s + (parseFloat(String(r.work_hours)) || 0), 0)
  const totalOvertime = records.reduce((s, r) => s + (parseFloat(String(r.overtime_hours)) || 0), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t('attendance')}</h1>
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
          <Button variant="outline" size="sm" onClick={() => { setSelectedDay(new Date().toISOString().split('T')[0]); setDialogOpen(true); setEditRecord(null) }}>
            <Plus className="h-4 w-4 mr-1.5" />
            {lang === 'ar' ? 'تسجيل يدوي' : 'Manual Record'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportAttendance}>
            <Download className="h-4 w-4 mr-1.5" />
            {t('exportExcel')}
          </Button>
        </div>
      </div>

      {/* Month KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10"><UserCheck className="h-4 w-4 text-emerald-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('present')}</p>
              <p className="text-xl font-bold text-emerald-500">{totalPresent}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10"><UserX className="h-4 w-4 text-rose-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('absent')}</p>
              <p className="text-xl font-bold text-rose-500">{totalAbsent}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Clock className="h-4 w-4 text-blue-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('workHours')}</p>
              <p className="text-xl font-bold">{Math.round(totalWorkHours)}h</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10"><Plus className="h-4 w-4 text-amber-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t('overtime')}</p>
              <p className="text-xl font-bold text-amber-500">{Math.round(totalOvertime * 10) / 10}h</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="calendar" dir={dir}>
        <TabsList>
          <TabsTrigger value="calendar">{lang === 'ar' ? 'التقويم' : 'Calendar'}</TabsTrigger>
          <TabsTrigger value="sheet">{t('monthlySheet')}</TabsTrigger>
        </TabsList>

        {/* Calendar View */}
        <TabsContent value="calendar">
          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" onClick={() => setCurrentDate(new Date(year, month + 1, 1))}>
                  <ChevronRight className="h-5 w-5" />
                </Button>
                <CardTitle className="text-xl">{monthLabel}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setCurrentDate(new Date(year, month - 1, 1))}>
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {dayNames.map((d, i) => (
                  <div key={d} className={`text-center text-xs font-medium py-2 ${i === 5 || i === 6 ? 'text-rose-400' : 'text-muted-foreground'}`}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {gridCells.map((day, idx) => {
                  if (day === null) return <div key={idx} />

                  const data = calendarData[day]
                  const weekend = isWeekend(day)
                  const todayMark = isToday(day)
                  const hasRecords = data && (data.present > 0 || data.absent > 0)

                  return (
                    <div
                      key={idx}
                      className={`min-h-[80px] rounded-lg p-2 border cursor-pointer transition-all hover:shadow-md ${
                        todayMark ? 'border-[#1976D2] bg-[#1976D2]/5 shadow-sm' :
                        weekend ? 'bg-rose-500/5 border-rose-500/20' :
                        'border-border hover:bg-accent/50'
                      }`}
                      onClick={() => {
                        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                        setSelectedDay(dateStr)
                        setDayDetailOpen(true)
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-semibold ${todayMark ? 'text-[#1976D2]' : weekend ? 'text-rose-400' : ''}`}>
                          {day}
                        </span>
                        {weekend && <span className="text-[8px] text-rose-400 font-medium">{lang === 'ar' ? 'عطلة' : 'OFF'}</span>}
                      </div>
                      {hasRecords && (
                        <div className="space-y-0.5">
                          {data.present > 0 && (
                            <div className="flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span className="text-[10px] text-emerald-500 font-medium">{data.present}</span>
                            </div>
                          )}
                          {data.absent > 0 && (
                            <div className="flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              <span className="text-[10px] text-rose-500 font-medium">{data.absent}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Legend */}
              <div className="flex gap-6 mt-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">{t('present')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                  <span className="text-muted-foreground">{t('absent')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500/30" />
                  <span className="text-muted-foreground">{lang === 'ar' ? 'عطلة نهاية الأسبوع' : 'Weekend'}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monthly Sheet */}
        <TabsContent value="sheet">
          <Card className="border-0 shadow-lg">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">{t('name')}</TableHead>
                      <TableHead className="text-center">{t('present')}</TableHead>
                      <TableHead className="text-center">{t('absent')}</TableHead>
                      <TableHead className="text-center">{lang === 'ar' ? 'عمل عطلة' : 'Holiday'}</TableHead>
                      <TableHead className="text-center">{t('workHours')}</TableHead>
                      <TableHead className="text-center">{t('overtime')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyStats.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('noData')}</TableCell>
                      </TableRow>
                    ) : (
                      monthlyStats.map(emp => (
                        <TableRow key={emp.id}>
                          <TableCell className="font-medium">{emp.name}</TableCell>
                          <TableCell className="text-center">
                            <Badge className="bg-emerald-500/10 text-emerald-500 border-0">{emp.presentDays}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {emp.absentDays > 0 ? (
                              <Badge className="bg-rose-500/10 text-rose-500 border-0">{emp.absentDays}</Badge>
                            ) : <span className="text-muted-foreground">0</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            {emp.holidayDays > 0 ? (
                              <Badge className="bg-purple-500/10 text-purple-500 border-0">⭐ {emp.holidayDays}</Badge>
                            ) : <span className="text-muted-foreground">0</span>}
                          </TableCell>
                          <TableCell className="text-center font-mono">{emp.totalWorkHours}h</TableCell>
                          <TableCell className="text-center">
                            {emp.totalOvertime > 0 ? (
                              <span className="text-blue-500 font-mono font-semibold">+{emp.totalOvertime}h</span>
                            ) : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Record Attendance Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg" dir={dir}>
          <DialogHeader>
            <DialogTitle>
              {editRecord
                ? `${lang === 'ar' ? 'تعديل حضور' : 'Edit Attendance'} — ${editRecord.employee?.name}`
                : `${t('recordAttendance')} — ${selectedDay}`
              }
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('date')} *</Label>
              <Input type="date" value={selectedDay || ''} onChange={e => setSelectedDay(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('checkIn')} *</Label>
                <Input type="time" value={form.check_in} onChange={e => setForm(f => ({ ...f, check_in: e.target.value }))} />
              </div>
              <div>
                <Label>{t('checkOut')}</Label>
                <Input type="time" value={form.check_out} onChange={e => setForm(f => ({ ...f, check_out: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === 'ar'
                ? '💡 الغياب يُسجل تلقائياً عبر المعالجة اليومية في الإعدادات ← الأتمتة'
                : '💡 Absences are auto-detected via daily processing in Settings → Automation'}
            </p>

            {!editRecord && (
              <>
                {/* Existing records for this day */}
                {dayDetailRecords.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">{lang === 'ar' ? 'السجلات الحالية' : 'Existing records'}:</p>
                    <div className="border rounded-lg p-2 max-h-32 overflow-y-auto space-y-1">
                      {dayDetailRecords.map(rec => (
                        <div key={rec.id} className="flex items-center justify-between text-sm p-1">
                          <span>{rec.employee?.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {rec.status === 'present' ? `${rec.check_in} → ${rec.check_out || '...'}` : t('absent')}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>{lang === 'ar' ? 'اختر الموظفين' : 'Select employees'}</Label>
                    <Button variant="ghost" size="sm" className="text-xs h-6" onClick={selectAllEmployees}>
                      {selectedEmployees.length === filteredEmployees.length ? (lang === 'ar' ? 'إلغاء الكل' : 'Deselect all') : (lang === 'ar' ? 'تحديد الكل' : 'Select all')}
                    </Button>
                  </div>
                  <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-1.5">
                    {filteredEmployees.map(emp => {
                      const hasRecord = dayDetailRecords.some(r => r.employee_id === emp.id)
                      return (
                        <label key={emp.id} className={`flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-accent ${hasRecord ? 'opacity-50' : ''}`}>
                          <Checkbox
                            checked={selectedEmployees.includes(emp.id)}
                            onCheckedChange={() => toggleEmployee(emp.id)}
                            disabled={hasRecord}
                          />
                          <span className="text-sm flex-1">{emp.name}</span>
                          {hasRecord && <Badge variant="outline" className="text-[10px] h-5">{lang === 'ar' ? 'مسجل' : 'recorded'}</Badge>}
                        </label>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedEmployees.length} {lang === 'ar' ? 'محدد' : 'selected'}
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || (!editRecord && selectedEmployees.length === 0)}>
              {createMutation.isPending ? '...' : editRecord ? t('save') : t('add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Day Detail Dialog */}
      <Dialog open={dayDetailOpen} onOpenChange={setDayDetailOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col" dir={dir}>
          <DialogHeader>
            <DialogTitle>
              {selectedDay} — {dayDetailRecords.length} {lang === 'ar' ? 'سجل' : 'records'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2">
            {/* Warn about employees with both attendance and leave */}
            {selectedDay && (() => {
              const dayLeaves = leaves.filter(l => l.status === 'approved' && l.start_date <= selectedDay && l.end_date >= selectedDay)
              const conflicts = dayDetailRecords.filter(rec => rec.status === 'present' && rec.check_in && dayLeaves.some(l => l.employee_id === rec.employee_id))
              if (conflicts.length === 0) return null
              return (
                <div className="p-3 rounded-lg bg-amber-500/10 text-amber-600 text-xs">
                  <p className="font-semibold mb-1">⚠️ {lang === 'ar' ? 'تعارض: حضور وإجازة في نفس اليوم' : 'Conflict: Attendance + Leave on same day'}</p>
                  {conflicts.map(rec => {
                    const leave = dayLeaves.find(l => l.employee_id === rec.employee_id)
                    return <p key={rec.id}>{rec.employee?.name} — {lang === 'ar' ? 'لديه إجازة معتمدة' : 'has approved leave'} ({leave?.leave_type?.name_en})</p>
                  })}
                </div>
              )
            })()}
            {dayDetailRecords.length > 0 ? (
              dayDetailRecords.map(rec => (
                <div key={rec.id} className="flex items-center justify-between p-3 rounded-xl bg-accent/20">
                  <div className="flex items-center gap-3 min-w-0">
                    {rec.status === 'present'
                      ? <UserCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                      : <UserX className="h-4 w-4 text-rose-500 shrink-0" />
                    }
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{rec.employee?.name}</p>
                        {rec.is_holiday_work && <Badge className="bg-purple-500/10 text-purple-500 border-0 text-[9px] h-4 shrink-0">⭐</Badge>}
                        {rec.excused_tardiness && <Badge className="bg-blue-500/10 text-blue-500 border-0 text-[9px] h-4 shrink-0">{t('excused')}</Badge>}
                        {rec.is_offsite && <Badge className="bg-amber-500/10 text-amber-500 border-0 text-[9px] h-4 shrink-0">{lang === 'ar' ? 'خارج المكتب' : 'Off-site'}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">
                        {rec.check_in ? `${rec.check_in?.slice(0, 5)} → ${rec.check_out?.slice(0, 5) || '...'}` : t('absent')}
                        {rec.work_hours > 0 && ` · ${rec.work_hours}h`}
                        {rec.overtime_hours > 0 && ` (+${rec.overtime_hours}h OT)`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-7 w-7 ${rec.excused_tardiness ? 'text-blue-500 bg-blue-500/10' : 'text-muted-foreground hover:bg-blue-500/10 hover:text-blue-500'}`}
                      title={t('excusedTardiness')}
                      onClick={() => toggleExcusedMutation.mutate({ id: rec.id, excused: !rec.excused_tardiness })}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-[#1976D2] hover:bg-[#1976D2]/10"
                      onClick={() => {
                        setEditRecord(rec)
                        setForm({
                          check_in: rec.check_in?.slice(0, 5) || '08:00',
                          check_out: rec.check_out?.slice(0, 5) || '16:00',
                          status: rec.status,
                        })
                        setDayDetailOpen(false)
                        setDialogOpen(true)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-rose-500 hover:bg-rose-500/10"
                      onClick={() => deleteMutation.mutate(rec.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center py-4 text-muted-foreground text-sm">{t('noData')}</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => { setDayDetailOpen(false); openDayDialog(parseInt(selectedDay?.split('-')[2] || '1')) }}>
              <Plus className="h-4 w-4 ml-2" />
              {t('recordAttendance')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
