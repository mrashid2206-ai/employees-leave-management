'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Plus, Trash2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { getEmployees, getTardinessRecords, createBulkTardiness, deleteTardinessRecord, getSettings } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useLanguage, useT } from '@/lib/language-context'

function timeToMinutes(time: string, workStartTime: string = '08:00'): number {
  const [h, m] = time.split(':').map(Number)
  const totalMinutes = h * 60 + m
  const [sh, sm] = workStartTime.split(':').map(Number)
  const workStart = sh * 60 + sm
  return Math.max(0, totalMinutes - workStart)
}

export default function TardinessPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [selectedEmployees, setSelectedEmployees] = useState<number[]>([])
  const t = useT()
  const { dir, lang } = useLanguage()
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number }>({ open: false, id: 0 })

  const now = new Date()
  const [filterYear, setFilterYear] = useState<string>('all')
  const [filterMonth, setFilterMonth] = useState<string>('all')
  const [filterDay, setFilterDay] = useState<string>('all')

  const monthNames = lang === 'ar'
    ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const daysInMonth = filterYear !== 'all' && filterMonth !== 'all'
    ? new Date(parseInt(filterYear), parseInt(filterMonth), 0).getDate()
    : 31

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: allRecords = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })

  const defaultArrivalTime = useMemo(() => {
    const startTime = settings?.work_start_time || '08:00'
    const [h, m] = startTime.split(':').map(Number)
    const totalMinutes = h * 60 + m + 15
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
  }, [settings?.work_start_time])
  const [form, setForm] = useState({ date: '', time: defaultArrivalTime, notes: '' })

  const records = allRecords.filter(r => {
    if (!r.date) return true
    const [y, m, d] = r.date.split('-')
    if (filterYear !== 'all' && y !== filterYear) return false
    if (filterMonth !== 'all' && parseInt(m) !== parseInt(filterMonth)) return false
    if (filterDay !== 'all' && parseInt(d) !== parseInt(filterDay)) return false
    return true
  })

  const createMutation = useMutation({
    mutationFn: createBulkTardiness,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tardiness'] })
      setOpen(false)
      setSelectedEmployees([])
      setForm({ date: '', time: defaultArrivalTime, notes: '' })
      toast.success(t('addedSuccess'))
    },
    onError: () => toast.error(t('error')),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTardinessRecord,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tardiness'] })
      toast.success(t('deletedSuccess'))
    },
  })

  function handleSubmit() {
    if (selectedEmployees.length === 0 || !form.date || !form.time) {
      toast.error(t('fillRequired'))
      return
    }
    const minutesLate = timeToMinutes(form.time, settings?.work_start_time)
    if (minutesLate <= 0) {
      toast.error(t('arrivalAfterStart'))
      return
    }
    const records = selectedEmployees.map(empId => ({
      employee_id: empId,
      date: form.date,
      time: form.time + ':00',
      minutes_late: minutesLate,
      notes: form.notes || undefined,
    }))
    createMutation.mutate(records)
  }

  function toggleEmployee(empId: number) {
    setSelectedEmployees(prev =>
      prev.includes(empId) ? prev.filter(id => id !== empId) : [...prev, empId]
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t('tardiness')}</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 ml-2" />
            {t('addTardiness')}
          </DialogTrigger>
          <DialogContent className="max-w-lg" dir={dir}>
            <DialogHeader>
              <DialogTitle>{t('addTardiness')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('date')} *</Label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>{t('arrivalTime')} *</Label>
                  <Input
                    type="time"
                    value={form.time}
                    onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                  />
                </div>
              </div>
              {form.time && timeToMinutes(form.time, settings?.work_start_time) > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('lateMinutes')}: <strong>{timeToMinutes(form.time, settings?.work_start_time)}</strong>
                </p>
              )}
              <div>
                <Label className="mb-2 block">{t('employees')} * ({t('selectEmployee')})</Label>
                <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                  {employees.filter(e => e.is_active).map(emp => (
                    <label key={emp.id} className="flex items-center gap-2 cursor-pointer hover:bg-accent p-1 rounded">
                      <Checkbox
                        checked={selectedEmployees.includes(emp.id)}
                        onCheckedChange={() => toggleEmployee(emp.id)}
                      />
                      <span className="text-sm">{emp.name}</span>
                      <span className="text-xs text-muted-foreground mr-auto">{emp.department?.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('selectedEmployees')} {selectedEmployees.length} {t('employeeUnit')}
                </p>
              </div>
              <div>
                <Label>{t('notes')}</Label>
                <Textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder={t('optionalNotes')}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? '...' : t('add')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterYear} onValueChange={v => { setFilterYear(v ?? 'all'); setFilterDay('all') }}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder={lang === 'ar' ? 'السنة' : 'Year'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{lang === 'ar' ? 'كل السنوات' : 'All Years'}</SelectItem>
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterMonth} onValueChange={v => { setFilterMonth(v ?? 'all'); setFilterDay('all') }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={lang === 'ar' ? 'الشهر' : 'Month'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{lang === 'ar' ? 'كل الشهور' : 'All Months'}</SelectItem>
            {monthNames.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterDay} onValueChange={v => setFilterDay(v ?? 'all')}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder={lang === 'ar' ? 'اليوم' : 'Day'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{lang === 'ar' ? 'كل الأيام' : 'All Days'}</SelectItem>
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
              <SelectItem key={d} value={String(d)}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-12">#</TableHead>
                  <TableHead className="text-start">{t('name')}</TableHead>
                  <TableHead className="text-center">{t('date')}</TableHead>
                  <TableHead className="text-center">{t('arrivalTime')}</TableHead>
                  <TableHead className="text-center">{t('lateMinutes')}</TableHead>
                  <TableHead className="text-start">{t('notes')}</TableHead>
                  <TableHead className="text-center w-16">{t('delete')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {t('noTardiness')}
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((rec, idx) => (
                    <TableRow key={rec.id}>
                      <TableCell className="text-center">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{rec.employee?.name}</TableCell>
                      <TableCell className="text-center">{rec.date}</TableCell>
                      <TableCell className="text-center">{rec.time}</TableCell>
                      <TableCell className="text-center font-bold">{rec.minutes_late}</TableCell>
                      <TableCell>{rec.notes || '-'}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-[#F44336] hover:text-[#F44336] hover:bg-[#F44336]/10"
                          onClick={() => setDeleteConfirm({ open: true, id: rec.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(c => ({ ...c, open }))}
        title={t('deleteTardiness')}
        description={t('areYouSure') + '?'}
        onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
