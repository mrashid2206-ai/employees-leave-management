'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Plus, Trash2, Pencil, AlertTriangle, CheckCircle, XCircle, Download, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  getEmployees, getLeaveRequests, getLeaveTypes, getDepartments, deleteLeaveRequest, checkLeaveConflict,
  decideLeavesBulk, type BulkDecisionItem,
} from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DecisionDialog } from '@/components/decision-dialog'
import { DecisionTrace, decisionDate } from '@/components/decision-trace'
import { useLanguage, useT } from '@/lib/language-context'
import { QueryError } from '@/components/query-error'
import { exportToExcel } from '@/lib/excel'
import { omanToday } from '@/lib/oman-date'
import { invalidateAfterLeaveDecision, useLeaveDecision } from '../_components/leave-decision'

interface CreateLeavePayload {
  employee_id: number
  leave_type_id: number
  start_date: string
  end_date: string
  days_count: number
  notes?: string
  is_half_day: boolean
}

interface CreateLeaveResponse {
  error?: string
  warning?: boolean
  absentCount?: number
  maxAbsent?: number
}

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
    is_half_day: false,
  })
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number }>({ open: false, id: 0 })
  const [editLeave, setEditLeave] = useState<{ id: number; start_date: string; end_date: string } | null>(null)
  const t = useT()
  const { dir, lang } = useLanguage()
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [conflict, setConflict] = useState<{ conflict: boolean; message: string; absentCount: number } | null>(null)
  const [workingDays, setWorkingDays] = useState<number | null>(null)

  const [filterYear, setFilterYear] = useState<string>('all')
  const [filterMonth, setFilterMonth] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterEmployee, setFilterEmployee] = useState<string>('all')
  const [filterDept, setFilterDept] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [bulkDecision, setBulkDecision] = useState<'approve' | 'reject' | null>(null)

  const monthNames = lang === 'ar'
    ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: allLeaves = [], isError: leavesError, refetch: refetchLeaves } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })

  const leaves = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allLeaves.filter(l => {
      if (l.start_date) {
        const [y, m] = l.start_date.split('-')
        if (filterYear !== 'all' && y !== filterYear) return false
        if (filterMonth !== 'all' && parseInt(m) !== parseInt(filterMonth)) return false
      }
      if (filterStatus !== 'all' && l.status !== filterStatus) return false
      if (filterEmployee !== 'all' && l.employee_id !== parseInt(filterEmployee)) return false
      if (filterDept !== 'all' && l.employee?.department_id !== parseInt(filterDept)) return false
      if (filterType !== 'all' && l.leave_type_id !== parseInt(filterType)) return false
      if (needle && !(l.employee?.name ?? '').toLowerCase().includes(needle)) return false
      return true
    })
  }, [allLeaves, filterYear, filterMonth, filterStatus, filterEmployee, filterDept, filterType, search])

  // Only a pending request can be bulk-decided: the server refuses re-deciding the rest,
  // and select-all used to sweep those in and then report a blanket success. A selection
  // also only counts while its row is on screen, so narrowing a filter can't act on rows
  // the admin can no longer see.
  const selectableIds = useMemo(() => new Set(leaves.filter(l => l.status === 'pending').map(l => l.id)), [leaves])
  const visibleSelected = selectedIds.filter(id => selectableIds.has(id))

  const leaveDecision = useLeaveDecision()

  // Fetch working days when dates change
  useEffect(() => {
    let cancelled = false
    async function loadWorkingDays() {
      if (form.start_date && form.end_date && new Date(form.end_date) >= new Date(form.start_date)) {
        try {
          const r = await fetch(`/api/working-days?start=${form.start_date}&end=${form.end_date}`)
          const d: { workingDays: number } = await r.json()
          if (!cancelled) setWorkingDays(d.workingDays)
        } catch {
          if (!cancelled) setWorkingDays(null)
        }
      } else {
        if (!cancelled) setWorkingDays(null)
      }
    }
    loadWorkingDays()
    return () => { cancelled = true }
  }, [form.start_date, form.end_date])

  // Get selected employee's balance
  const selectedEmpBalance = useMemo(() => {
    if (!form.employee_id) return null
    const emp = employees.find(e => e.id === parseInt(form.employee_id))
    return emp?.leave_balance ?? null
  }, [form.employee_id, employees])

  // Check conflict when employee + dates change
  useEffect(() => {
    let cancelled = false
    async function check() {
      if (form.employee_id && form.start_date && form.end_date) {
        try {
          const result = await checkLeaveConflict(
            parseInt(form.employee_id),
            form.start_date,
            form.end_date
          )
          if (!cancelled) setConflict(result)
        } catch {
          if (!cancelled) setConflict(null)
        }
      } else {
        if (!cancelled) setConflict(null)
      }
    }
    check()
    return () => { cancelled = true }
  }, [form.employee_id, form.start_date, form.end_date])

  const createMutation = useMutation({
    mutationFn: (data: CreateLeavePayload) => fetch('/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(async r => {
      const json: CreateLeaveResponse = await r.json()
      if (!r.ok) {
        // If it's a dept limit warning, ask admin to confirm override
        if (json.warning && json.absentCount) {
          const msg = lang === 'ar'
            ? `تحذير: ${json.absentCount}/${json.maxAbsent} موظف من نفس القسم في إجازة. هل تريد المتابعة؟`
            : `Warning: ${json.absentCount}/${json.maxAbsent} employees from this department already on leave. Continue anyway?`
          if (confirm(msg)) {
            // Retry with force flag
            const retryRes = await fetch('/api/leaves', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...data, force: true }),
            })
            if (!retryRes.ok) {
              const retryJson: CreateLeaveResponse = await retryRes.json()
              throw new Error(retryJson.error)
            }
            return retryRes.json()
          }
          throw new Error('Cancelled by admin')
        }
        throw new Error(json.error || 'Failed')
      }
      return json
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setOpen(false)
      setForm({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', notes: '', is_half_day: false })
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

  // One request to the server, which decides each id in turn exactly as a single click
  // would, and answers per id — so a partial success is reported as one.
  const bulkStatusMutation = useMutation({
    mutationFn: (input: { ids: number[]; status: 'approved' | 'rejected'; note?: string; force?: boolean }) =>
      decideLeavesBulk({ ...input, note: input.note || null }),
    onSuccess: (data, vars) => {
      invalidateAfterLeaveDecision(queryClient)
      setSelectedIds([])
      setBulkDecision(null)
      const done = t(vars.status === 'approved' ? 'bulkApprovedCount' : 'bulkRejectedCount', { count: data.succeeded })
      if (data.failed === 0) {
        toast.success(done)
        return
      }
      const nameOf = (item: BulkDecisionItem) => allLeaves.find(l => l.id === item.id)?.employee?.name ?? `#${item.id}`
      const failures = data.results.filter(r => !r.ok)
      toast.warning(`${done} · ${t('bulkFailedCount', { count: data.failed })}`, {
        description: (
          <ul className="mt-1 space-y-0.5 text-xs">
            {failures.slice(0, 5).map(f => (
              <li key={f.id}><span className="font-medium">{nameOf(f)}</span>: {f.error}</li>
            ))}
            {failures.length > 5 && <li>+{failures.length - 5} {t('more')}</li>}
          </ul>
        ),
        duration: 15000,
      })
    },
    onError: (err: Error) => toast.error(err.message || t('error')),
  })

  function handleExport() {
    const typeName = (id: number) => {
      const lt = leaveTypes.find(x => x.id === id)
      return (lang === 'ar' ? lt?.name_ar : lt?.name_en) ?? ''
    }
    const deptName = (id?: number) => departments.find(d => d.id === id)?.name ?? ''
    const statusLabel = (s: string) =>
      s === 'approved' || s === 'rejected' || s === 'cancelled' || s === 'pending' ? t(s) : s
    const rows = leaves.map(l => ({
      [t('name')]: l.employee?.name ?? '',
      [t('department')]: deptName(l.employee?.department_id),
      [t('leaveType')]: typeName(l.leave_type_id),
      [t('fromDate')]: l.start_date,
      [t('toDate')]: l.end_date,
      [t('daysCount')]: l.days_count,
      [t('status')]: statusLabel(l.status),
      [t('notes')]: l.notes ?? '',
      [t('reviewedBy')]: l.reviewed_by ?? '',
      [t('reviewedAt')]: decisionDate(l.reviewed_at),
      [t('decisionNoteLabel')]: l.decision_note ?? '',
    }))
    exportToExcel(rows, `leaves-${omanToday()}`, t('leaves'))
  }

  const editMutation = useMutation({
    mutationFn: ({ id, start_date, end_date }: { id: number; start_date: string; end_date: string }) =>
      fetch(`/api/leaves/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date, end_date }),
      }).then(r => {
        if (!r.ok) return r.json().then((d: { error?: string }) => { throw new Error(d.error) })
        return r.json()
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setEditLeave(null)
      toast.success(t('updatedSuccess'))
    },
    onError: (err: Error) => toast.error(err.message || t('error')),
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
      days_count: form.is_half_day && form.start_date === form.end_date ? 0.5 : daysCount,
      notes: form.notes || undefined,
      is_half_day: form.is_half_day,
    })
  }

  const daysCount = calculateDaysCount(form.start_date, form.end_date)

  return (
    <div className="space-y-6">
      {leavesError && <QueryError onRetry={() => refetchLeaves()} />}
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
              {form.start_date && form.end_date && form.start_date === form.end_date && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="half-day"
                    checked={form.is_half_day || false}
                    onCheckedChange={(checked) => setForm(f => ({ ...f, is_half_day: !!checked }))}
                    disabled={form.start_date !== form.end_date}
                  />
                  <Label htmlFor="half-day" className="text-sm">
                    {t('halfDay')}
                  </Label>
                </div>
              )}
              {daysCount > 0 && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    {t('daysCount')}: <strong>{form.is_half_day && form.start_date === form.end_date ? 0.5 : (workingDays ?? daysCount)}</strong>
                    {workingDays !== null && workingDays < daysCount && (
                      <span className="text-xs ml-1">({t('workingDaysOnly')})</span>
                    )}
                  </p>
                  {selectedEmpBalance !== null && (
                    <p className={`text-sm ${(workingDays ?? daysCount) > selectedEmpBalance ? 'text-rose-500 font-semibold' : 'text-muted-foreground'}`}>
                      {t('leaveBalance')}: <strong>{selectedEmpBalance}</strong> {t('days')}
                      {(workingDays ?? daysCount) > selectedEmpBalance && (
                        <span className="ml-1">⚠️ {t('insufficientBalance')}</span>
                      )}
                    </p>
                  )}
                </div>
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-56">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('search')}
            className="ps-8"
            aria-label={t('search')}
          />
        </div>
        <Select value={filterStatus} onValueChange={v => setFilterStatus(v ?? 'all')}>
          <SelectTrigger className="w-36" aria-label={t('status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatus')}</SelectItem>
            <SelectItem value="pending">{t('pendingOnly')}</SelectItem>
            <SelectItem value="approved">{t('approved')}</SelectItem>
            <SelectItem value="rejected">{t('rejected')}</SelectItem>
            <SelectItem value="cancelled">{t('cancelled')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterEmployee} onValueChange={v => setFilterEmployee(v ?? 'all')}>
          <SelectTrigger className="w-44" aria-label={t('selectEmployee')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allEmployees')}</SelectItem>
            {[...employees].sort((a, b) => a.name.localeCompare(b.name)).map(e => (
              <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterDept} onValueChange={v => setFilterDept(v ?? 'all')}>
          <SelectTrigger className="w-40" aria-label={t('department')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allDepts')}</SelectItem>
            {departments.map(d => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={v => setFilterType(v ?? 'all')}>
          <SelectTrigger className="w-40" aria-label={t('leaveType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allLeaveTypes')}</SelectItem>
            {leaveTypes.map(lt => (
              <SelectItem key={lt.id} value={String(lt.id)}>{lang === 'ar' ? lt.name_ar : lt.name_en}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterYear} onValueChange={v => { setFilterYear(v ?? 'all'); setSelectedIds([]) }}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder={t('year')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allYears')}</SelectItem>
            {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterMonth} onValueChange={v => { setFilterMonth(v ?? 'all'); setSelectedIds([]) }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('month')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allMonths')}</SelectItem>
            {monthNames.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="ms-auto" onClick={handleExport} disabled={leaves.length === 0}>
          <Download className="h-4 w-4 me-1.5" />
          {t('exportExcel')}
        </Button>
      </div>

      {/* Bulk Actions Bar */}
      {visibleSelected.length > 0 && (
        <Card className="border-[#1976D2]/30 bg-[#1976D2]/5">
          <CardContent className="p-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{visibleSelected.length} {t('selected')}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                disabled={bulkStatusMutation.isPending}
                onClick={() => setBulkDecision('approve')}
              >
                <CheckCircle className="h-3.5 w-3.5 me-1" />
                {t('approve')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-rose-500 border-rose-500/30 hover:bg-rose-500/10"
                disabled={bulkStatusMutation.isPending}
                onClick={() => setBulkDecision('reject')}
              >
                <XCircle className="h-3.5 w-3.5 me-1" />
                {t('reject')}
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
                      aria-label={t('onlyPendingSelectable')}
                      title={t('onlyPendingSelectable')}
                      disabled={selectableIds.size === 0}
                      checked={selectableIds.size > 0 && visibleSelected.length === selectableIds.size}
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedIds([...selectableIds])
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
                  <TableHead className="text-center w-20">{t('actions')}</TableHead>
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
                            disabled={leave.status !== 'pending'}
                            checked={leave.status === 'pending' && selectedIds.includes(leave.id)}
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
                          ) : leave.status === 'cancelled' ? (
                            <Badge className="bg-gray-500/10 text-gray-500 border-0">{t('cancelled')}</Badge>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <Badge className="bg-[#FF9800]/10 text-[#FF9800] border-0">{t('pending')}</Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-[#4CAF50] hover:bg-[#4CAF50]/10"
                                aria-label={t('approve')}
                                disabled={leaveDecision.isPending}
                                onClick={(e) => { e.stopPropagation(); leaveDecision.approve(leave) }}
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-[#F44336] hover:bg-[#F44336]/10"
                                aria-label={t('reject')}
                                disabled={leaveDecision.isPending}
                                onClick={(e) => { e.stopPropagation(); leaveDecision.reject(leave) }}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                          <DecisionTrace {...leave} />
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-primary hover:bg-primary/10"
                              onClick={() => setEditLeave({ id: leave.id, start_date: leave.start_date, end_date: leave.end_date })}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteConfirm({ open: true, id: leave.id })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
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

      {leaveDecision.dialog}

      {bulkDecision && (
        <DecisionDialog
          open
          onOpenChange={open => { if (!open) setBulkDecision(null) }}
          mode={bulkDecision}
          title={t(bulkDecision === 'approve' ? 'bulkApproveConfirm' : 'bulkRejectConfirm', { count: visibleSelected.length })}
          overrideLabel={bulkDecision === 'approve' ? t('overrideDeptLimit') : undefined}
          loading={bulkStatusMutation.isPending}
          onConfirm={(note, override) =>
            bulkStatusMutation.mutate({
              ids: visibleSelected,
              status: bulkDecision === 'approve' ? 'approved' : 'rejected',
              note,
              force: bulkDecision === 'approve' && override,
            })
          }
        />
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(c => ({ ...c, open }))}
        title={t('deleteLeave')}
        description={t('areYouSure') + '?'}
        onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
        loading={deleteMutation.isPending}
      />

      {/* Edit Leave Dialog */}
      {editLeave && (
        <Dialog open={!!editLeave} onOpenChange={() => setEditLeave(null)}>
          <DialogContent className="max-w-sm" dir={dir}>
            <DialogHeader>
              <DialogTitle>{t('editLeave')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('fromDate')}</Label>
                <Input type="date" value={editLeave.start_date} onChange={e => setEditLeave(prev => prev ? { ...prev, start_date: e.target.value } : null)} />
              </div>
              <div>
                <Label>{t('toDate')}</Label>
                <Input type="date" value={editLeave.end_date} onChange={e => setEditLeave(prev => prev ? { ...prev, end_date: e.target.value } : null)} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('workingDaysAndBalanceWill')}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditLeave(null)}>{t('cancel')}</Button>
              <Button onClick={() => editLeave && editMutation.mutate(editLeave)} disabled={editMutation.isPending}>
                {editMutation.isPending ? '...' : t('save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
