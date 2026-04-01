'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Plus, Trash2, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  getEmployees, getLeaveRequests, getLeaveTypes, createLeaveRequest, deleteLeaveRequest, checkLeaveConflict, updateLeaveStatus
} from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useLanguage, useT } from '@/lib/language-context'

function calculateDaysCount(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start)
  const e = new Date(end)
  const diff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
  return diff > 0 ? diff : 0
}

export default function LeavesPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    employee_id: '',
    leave_type_id: '',
    start_date: '',
    end_date: '',
    notes: '',
  })
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number }>({ open: false, id: 0 })
  const t = useT()
  const { dir, lang } = useLanguage()
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [conflict, setConflict] = useState<{ conflict: boolean; message: string; absentCount: number } | null>(null)
  const [checkingConflict, setCheckingConflict] = useState(false)

  const [filterYear, setFilterYear] = useState<string>('all')
  const [filterMonth, setFilterMonth] = useState<string>('all')

  const monthNames = lang === 'ar'
    ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: allLeaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })

  const leaves = allLeaves.filter(l => {
    if (!l.start_date) return true
    const [y, m] = l.start_date.split('-')
    if (filterYear !== 'all' && y !== filterYear) return false
    if (filterMonth !== 'all' && parseInt(m) !== parseInt(filterMonth)) return false
    return true
  })

  // Check conflict when employee + dates change
  useEffect(() => {
    async function check() {
      if (form.employee_id && form.start_date && form.end_date) {
        setCheckingConflict(true)
        try {
          const result = await checkLeaveConflict(
            parseInt(form.employee_id),
            form.start_date,
            form.end_date
          )
          setConflict(result)
        } catch {
          setConflict(null)
        }
        setCheckingConflict(false)
      } else {
        setConflict(null)
      }
    }
    check()
  }, [form.employee_id, form.start_date, form.end_date])

  const createMutation = useMutation({
    mutationFn: createLeaveRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setOpen(false)
      setForm({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', notes: '' })
      toast.success(t('addedSuccess'))
    },
    onError: () => toast.error(t('error')),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteLeaveRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] })
      toast.success(t('deletedSuccess'))
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => updateLeaveStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] })
      toast.success(t('updatedSuccess'))
    },
  })

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: string }) => {
      await Promise.all(ids.map(id => updateLeaveStatus(id, status)))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] })
      setSelectedIds([])
      toast.success(t('updatedSuccess'))
    },
  })

  function handleSubmit() {
    if (!form.employee_id || !form.leave_type_id || !form.start_date || !form.end_date) {
      toast.error(t('fillRequired'))
      return
    }
    const daysCount = calculateDaysCount(form.start_date, form.end_date)
    if (daysCount <= 0) {
      toast.error(t('endDateAfterStart'))
      return
    }
    createMutation.mutate({
      employee_id: parseInt(form.employee_id),
      leave_type_id: parseInt(form.leave_type_id),
      start_date: form.start_date,
      end_date: form.end_date,
      days_count: daysCount,
      notes: form.notes || undefined,
    })
  }

  const daysCount = calculateDaysCount(form.start_date, form.end_date)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('leaves')}</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 ml-2" />
            {t('addLeave')}
          </DialogTrigger>
          <DialogContent className="max-w-md" dir={dir}>
            <DialogHeader>
              <DialogTitle>{t('addLeave')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('selectEmployee')} *</Label>
                <Select value={form.employee_id} onValueChange={v => setForm(f => ({ ...f, employee_id: v ?? '' }))}>
                  <SelectTrigger><SelectValue placeholder={t('selectEmployee')} /></SelectTrigger>
                  <SelectContent>
                    {employees.filter(e => e.is_active).map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('leaveType')} *</Label>
                <Select value={form.leave_type_id} onValueChange={v => setForm(f => ({ ...f, leave_type_id: v ?? '' }))}>
                  <SelectTrigger><SelectValue placeholder={t('selectType')} /></SelectTrigger>
                  <SelectContent>
                    {leaveTypes.map(lt => (
                      <SelectItem key={lt.id} value={String(lt.id)}>{lang === 'ar' ? lt.name_ar : lt.name_en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('fromDate')} *</Label>
                  <Input
                    type="date"
                    value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>{t('toDate')} *</Label>
                  <Input
                    type="date"
                    value={form.end_date}
                    onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>
              {daysCount > 0 && (
                <p className="text-sm text-muted-foreground">{t('daysCount')}: <strong>{daysCount}</strong></p>
              )}
              {/* Conflict indicator */}
              {conflict && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                  conflict.conflict ? 'bg-[#F44336]/10 text-[#F44336]' : 'bg-[#4CAF50]/10 text-[#4CAF50]'
                }`}>
                  {conflict.conflict ? (
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                  ) : (
                    <CheckCircle className="h-4 w-4 shrink-0" />
                  )}
                  <span>{conflict.message}</span>
                </div>
              )}
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
        <Select value={filterYear} onValueChange={v => setFilterYear(v ?? 'all')}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder={lang === 'ar' ? 'السنة' : 'Year'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{lang === 'ar' ? 'كل السنوات' : 'All Years'}</SelectItem>
            {[2025, 2026, 2027].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterMonth} onValueChange={v => setFilterMonth(v ?? 'all')}>
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
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <Card className="border-[#1976D2]/30 bg-[#1976D2]/5">
          <CardContent className="p-3 flex items-center justify-between">
            <span className="text-sm font-medium">{selectedIds.length} {lang === 'ar' ? 'محدد' : 'selected'}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => bulkStatusMutation.mutate({ ids: selectedIds, status: 'approved' })}>
                {t('approved')}
              </Button>
              <Button size="sm" variant="outline" className="text-rose-500 border-rose-500/30 hover:bg-rose-500/10" onClick={() => bulkStatusMutation.mutate({ ids: selectedIds, status: 'rejected' })}>
                {t('rejected')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                {t('cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">
                    <Checkbox
                      checked={selectedIds.length === leaves.length && leaves.length > 0}
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedIds(leaves.map(l => l.id))
                        else setSelectedIds([])
                      }}
                    />
                  </TableHead>
                  <TableHead className="text-center w-12">#</TableHead>
                  <TableHead className="text-start">{t('name')}</TableHead>
                  <TableHead className="text-start">{t('leaveType')}</TableHead>
                  <TableHead className="text-center">{t('fromDate')}</TableHead>
                  <TableHead className="text-center">{t('toDate')}</TableHead>
                  <TableHead className="text-center">{t('daysCount')}</TableHead>
                  <TableHead className="text-start">{t('notes')}</TableHead>
                  <TableHead className="text-center">{t('status')}</TableHead>
                  <TableHead className="text-center w-16">{t('delete')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaves.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      {t('noLeaves')}
                    </TableCell>
                  </TableRow>
                ) : (
                  leaves.map((leave, idx) => {
                    const lt = leaveTypes.find(t => t.id === leave.leave_type_id)
                    return (
                      <TableRow key={leave.id}>
                        <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.includes(leave.id)}
                            onCheckedChange={(checked) => {
                              if (checked) setSelectedIds(prev => [...prev, leave.id])
                              else setSelectedIds(prev => prev.filter(id => id !== leave.id))
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-center">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{leave.employee?.name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lt?.color }} />
                            {lang === 'ar' ? lt?.name_ar : lt?.name_en}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">{leave.start_date}</TableCell>
                        <TableCell className="text-center">{leave.end_date}</TableCell>
                        <TableCell className="text-center font-bold">{leave.days_count}</TableCell>
                        <TableCell>{leave.notes || '-'}</TableCell>
                        <TableCell className="text-center">
                          {leave.status === 'approved' ? (
                            <Badge className="bg-[#4CAF50]/10 text-[#4CAF50] border-0">{t('approved')}</Badge>
                          ) : leave.status === 'rejected' ? (
                            <Badge className="bg-[#F44336]/10 text-[#F44336] border-0">{t('rejected')}</Badge>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <Badge className="bg-[#FF9800]/10 text-[#FF9800] border-0">{t('pending')}</Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-[#4CAF50] hover:bg-[#4CAF50]/10"
                                onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ id: leave.id, status: 'approved' }) }}
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-[#F44336] hover:bg-[#F44336]/10"
                                onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ id: leave.id, status: 'rejected' }) }}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-[#F44336] hover:text-[#F44336] hover:bg-[#F44336]/10"
                            onClick={() => setDeleteConfirm({ open: true, id: leave.id })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(c => ({ ...c, open }))}
        title={t('deleteLeave')}
        description={t('areYouSure') + '?'}
        onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
