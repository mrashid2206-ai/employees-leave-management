'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Search, ArrowUpDown, Plus, Trash2, Pencil, Upload, Power } from 'lucide-react'
import { getEmployees, getLeaveRequests, getTardinessRecords, getSettings, getDepartments, getLeaveTypes, createEmployee, deleteEmployee, updateEmployee } from '@/lib/api'
import type { Employee, ScheduleOverride } from '@/lib/types'
import { ScheduleFields } from '@/components/schedule-fields'
import { parseExcelFile } from '@/lib/excel'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useLanguage, useT } from '@/lib/language-context'
import { QueryError } from '@/components/query-error'

function formatMinutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

type SortField = 'name' | 'department' | 'balance' | 'used' | 'remaining' | 'tardiness'
type SortDir = 'asc' | 'desc'

function SortHeader({ field, onToggle, children }: { field: SortField; onToggle: (field: SortField) => void; children: React.ReactNode }) {
  return (
    <TableHead
      className="text-center cursor-pointer select-none hover:bg-accent"
      onClick={() => onToggle(field)}
    >
      <div className="flex items-center justify-center gap-1">
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </div>
    </TableHead>
  )
}

export default function EmployeesPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const t = useT()
  const { dir } = useLanguage()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [addOpen, setAddOpen] = useState(false)
  const [newEmp, setNewEmp] = useState({ name: '', department_id: '', leave_balance: '30', email: '', phone: '', position: '', join_date: '' })

  const createMutation = useMutation({
    mutationFn: createEmployee,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setAddOpen(false)
      setNewEmp({ name: '', department_id: '', leave_balance: String(settings?.annual_leave_balance || 30), email: '', phone: '', position: '', join_date: '' })
      toast.success(t('addedSuccess'))
    },
    onError: () => toast.error(t('error')),
  })

  const [editOpen, setEditOpen] = useState(false)
  const [editEmp, setEditEmp] = useState({ id: 0, name: '', department_id: '', leave_balance: '', email: '', phone: '', position: '', join_date: '' })
  // Per-employee schedule override, kept separate because blank/null is meaningful here
  // (it means "inherit the department's schedule") rather than just an empty field.
  const [editSchedule, setEditSchedule] = useState<ScheduleOverride>({})
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number; name: string }>({ open: false, id: 0, name: '' })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Employee> }) => updateEmployee(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setEditOpen(false)
      toast.success(t('updatedSuccess'))
    },
    onError: () => toast.error(t('error')),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteEmployee,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('deletedSuccess'))
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => updateEmployee(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('updatedSuccess'))
    },
    onError: () => toast.error(t('error')),
  })

  function handleEditEmployee() {
    if (!editEmp.name || !editEmp.department_id) {
      toast.error(t('fillRequired'))
      return
    }
    updateMutation.mutate({
      id: editEmp.id,
      data: {
        name: editEmp.name,
        department_id: parseInt(editEmp.department_id),
        leave_balance: parseInt(editEmp.leave_balance) || (settings?.annual_leave_balance || 30),
        email: editEmp.email || undefined,
        phone: editEmp.phone || undefined,
        position: editEmp.position || undefined,
        join_date: editEmp.join_date || undefined,
        // Sent explicitly (including null) so clearing a field really does reset the
        // employee back to inheriting their department's schedule.
        work_start_time: editSchedule.work_start_time ?? null,
        work_days: editSchedule.work_days ?? null,
        work_hours_per_day: editSchedule.work_hours_per_day ?? null,
      },
    })
  }

  function openEditDialog(emp: Employee) {
    setEditEmp({
      id: emp.id,
      name: emp.name,
      department_id: String(emp.department_id),
      leave_balance: String(emp.leave_balance),
      email: emp.email || '',
      phone: emp.phone || '',
      position: emp.position || '',
      join_date: emp.join_date || '',
    })
    setEditSchedule({
      work_start_time: emp.work_start_time ?? null,
      work_days: emp.work_days ?? null,
      work_hours_per_day: emp.work_hours_per_day ?? null,
    })
    setEditOpen(true)
  }

  function handleAddEmployee() {
    if (!newEmp.name || !newEmp.department_id) {
      toast.error(t('fillRequired'))
      return
    }
    createMutation.mutate({
      name: newEmp.name,
      department_id: parseInt(newEmp.department_id),
      leave_balance: parseInt(newEmp.leave_balance) || (settings?.annual_leave_balance || 30),
      email: newEmp.email || undefined,
      phone: newEmp.phone || undefined,
      position: newEmp.position || undefined,
      join_date: newEmp.join_date || undefined,
    })
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Bound the parser's exposure (xlsx@0.18.5 has unpatched ReDoS/proto-pollution advisories).
    const MAX_IMPORT_BYTES = 2 * 1024 * 1024 // 2 MB
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(t('fileTooLargeMax2'))
      e.target.value = ''
      return
    }

    try {
      const data = await parseExcelFile(file)
      let imported = 0
      for (const row of data) {
        const name = row['Name'] || row['name'] || row['الاسم']
        const deptName = row['Department'] || row['department'] || row['القسم']
        const balance = row['Leave Balance'] || row['leave_balance'] || row['الرصيد'] || (settings?.annual_leave_balance || 30)

        if (!name) continue

        // Find department by name
        const dept = departments.find(d => d.name === deptName)
        const deptId = dept?.id || departments[0]?.id

        if (deptId) {
          await fetch('/api/employees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, department_id: deptId, leave_balance: parseInt(String(balance)) || (settings?.annual_leave_balance || 30) }),
          })
          imported++
        }
      }

      queryClient.invalidateQueries({ queryKey: ['employees'] })
      toast.success(`${t('addedSuccess')} (${imported})`)
    } catch {
      toast.error(t('error'))
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const { data: employees = [], isError: employeesError, refetch: refetchEmployees } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })

  // What the employee being edited would inherit if their own schedule is left blank:
  // their department's override, falling back to the global schedule.
  const editEmpDeptSchedule = useMemo(() => {
    const dept = departments.find(d => String(d.id) === editEmp.department_id)
    return {
      work_start_time: dept?.work_start_time ?? settings?.work_start_time ?? null,
      work_days: dept?.work_days ?? settings?.work_days ?? null,
      work_hours_per_day: dept?.work_hours_per_day ?? settings?.work_hours_per_day ?? null,
    }
  }, [departments, settings, editEmp.department_id])

  const today = new Date().toISOString().split('T')[0]

  const employeeRows = useMemo(() => {
    return employees.map((emp, idx) => {
      const empLeaves = leaves.filter(l => l.employee_id === emp.id && l.status === 'approved')
      const usedDays = empLeaves.reduce((sum, l) => sum + l.days_count, 0)

      // By type
      const byType: Record<string, number> = {}
      leaveTypes.forEach(lt => {
        byType[lt.name_en] = empLeaves
          .filter(l => l.leave_type_id === lt.id)
          .reduce((sum, l) => sum + l.days_count, 0)
      })

      const empTardiness = tardiness.filter(t => t.employee_id === emp.id)
      const tardMinutes = empTardiness.reduce((sum, t) => sum + t.minutes_late, 0)
      const remaining = emp.leave_balance

      const isOnLeave = empLeaves.some(l => l.start_date <= today && l.end_date >= today)

      return {
        ...emp,
        index: idx + 1,
        departmentName: emp.department?.name || '',
        usedDays,
        byType,
        tardMinutes,
        remaining,
        isOnLeave,
      }
    })
  }, [employees, leaves, tardiness, leaveTypes, today])

  const filtered = useMemo(() => {
    let result = employeeRows
    if (search) {
      result = result.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    }
    if (deptFilter !== 'all') {
      result = result.filter(e => e.department_id === parseInt(deptFilter))
    }
    // Sort
    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'department': cmp = a.departmentName.localeCompare(b.departmentName); break
        case 'balance': cmp = a.leave_balance - b.leave_balance; break
        case 'used': cmp = a.usedDays - b.usedDays; break
        case 'remaining': cmp = a.remaining - b.remaining; break
        case 'tardiness': cmp = a.tardMinutes - b.tardMinutes; break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [employeeRows, search, deptFilter, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  return (
    <div className="space-y-6">
      {employeesError && <QueryError onRetry={() => refetchEmployees()} />}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('employees')}</h1>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 ml-2" />
            {t('importExcel')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportExcel}
          />
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 ml-2" />
            {t('addEmployee')}
          </DialogTrigger>
          <DialogContent className="max-w-md" dir={dir}>
            <DialogHeader>
              <DialogTitle>{t('addEmployee')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('employeeName')} *</Label>
                <Input
                  value={newEmp.name}
                  onChange={e => setNewEmp(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('enterEmployeeName')}
                />
              </div>
              <div>
                <Label>{t('department')} *</Label>
                <Select value={newEmp.department_id} onValueChange={v => setNewEmp(f => ({ ...f, department_id: v ?? '' }))}>
                  <SelectTrigger><SelectValue placeholder={t('allDepts')} /></SelectTrigger>
                  <SelectContent>
                    {departments.map(d => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('leaveBalance')}</Label>
                <Input
                  type="number"
                  value={newEmp.leave_balance}
                  onChange={e => setNewEmp(f => ({ ...f, leave_balance: e.target.value }))}
                />
              </div>
              <div>
                <Label>{t('email')}</Label>
                <Input
                  type="email"
                  value={newEmp.email}
                  onChange={e => setNewEmp(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <Label>{t('phone')}</Label>
                <Input
                  value={newEmp.phone}
                  onChange={e => setNewEmp(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div>
                <Label>{t('position')}</Label>
                <Input
                  value={newEmp.position}
                  onChange={e => setNewEmp(f => ({ ...f, position: e.target.value }))}
                />
              </div>
              <div>
                <Label>{t('joinDate')}</Label>
                <Input
                  type="date"
                  value={newEmp.join_date}
                  onChange={e => setNewEmp(f => ({ ...f, join_date: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAddEmployee} disabled={createMutation.isPending}>
                {createMutation.isPending ? '...' : t('add')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <CardTitle className="text-lg">{t('employees')}</CardTitle>
            <div className="flex gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('search')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="ps-9 w-full sm:w-64"
                />
              </div>
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
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-12">#</TableHead>
                  <SortHeader field="name" onToggle={toggleSort}>{t('name')}</SortHeader>
                  <SortHeader field="department" onToggle={toggleSort}>{t('department')}</SortHeader>
                  <SortHeader field="balance" onToggle={toggleSort}>{t('balance')}</SortHeader>
                  <SortHeader field="used" onToggle={toggleSort}>{t('used')}</SortHeader>
                  <TableHead className="text-center">{t('annual')}</TableHead>
                  <TableHead className="text-center">{t('sick')}</TableHead>
                  <TableHead className="text-center">{t('emergency')}</TableHead>
                  <TableHead className="text-center">{t('other')}</TableHead>
                  <SortHeader field="remaining" onToggle={toggleSort}>{t('remaining')}</SortHeader>
                  <SortHeader field="tardiness" onToggle={toggleSort}>{t('tardinessHHMM')}</SortHeader>
                  <TableHead className="text-center">{t('status')}</TableHead>
                  <TableHead className="text-center w-20">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((emp) => (
                  <TableRow
                    key={emp.id}
                    className={`cursor-pointer hover:bg-accent/50 ${!emp.is_active ? 'opacity-50' : ''}`}
                    onClick={() => router.push(`/employees/${emp.id}`)}
                  >
                    <TableCell className="text-center">{emp.index}</TableCell>
                    <TableCell className="font-medium">
                      {emp.name}
                      {!emp.is_active && (
                        <Badge variant="outline" className="ms-2 text-[10px] bg-muted text-muted-foreground border-muted-foreground/30">
                          {t('inactive')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{emp.departmentName}</TableCell>
                    <TableCell className="text-center">{emp.leave_balance}</TableCell>
                    <TableCell className="text-center">{emp.usedDays}</TableCell>
                    <TableCell className="text-center">{emp.byType['Annual'] || 0}</TableCell>
                    <TableCell className="text-center">{emp.byType['Sick'] || 0}</TableCell>
                    <TableCell className="text-center">{emp.byType['Emergency'] || 0}</TableCell>
                    <TableCell className="text-center">{emp.byType['Other'] || 0}</TableCell>
                    <TableCell className="text-center font-bold">
                      <span className={emp.remaining < 5 ? 'text-[#F44336]' : ''}>
                        {emp.remaining}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">{formatMinutesToHHMM(emp.tardMinutes)}</TableCell>
                    <TableCell className="text-center">
                      {!emp.is_active ? (
                        <Badge variant="outline" className="bg-muted text-muted-foreground border-muted-foreground/30">
                          {t('inactive')}
                        </Badge>
                      ) : emp.isOnLeave ? (
                        <Badge variant="outline" className="bg-[#FF9800]/10 text-[#FF9800] border-[#FF9800]/30">
                          {t('onLeave')} 🏖️
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-[#4CAF50]/10 text-[#4CAF50] border-[#4CAF50]/30">
                          {t('available')} ✅
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 ${emp.is_active ? 'text-emerald-500 hover:bg-emerald-500/10' : 'text-muted-foreground hover:bg-muted'}`}
                          title={emp.is_active ? (t('deactivate')) : (t('activate'))}
                          onClick={() => toggleActiveMutation.mutate({ id: emp.id, is_active: !emp.is_active })}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-[#1976D2] hover:bg-[#1976D2]/10"
                          onClick={() => openEditDialog(emp)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-[#F44336] hover:bg-[#F44336]/10"
                          onClick={() => setDeleteConfirm({ open: true, id: emp.id, name: emp.name })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Employee Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md" dir={dir}>
          <DialogHeader>
            <DialogTitle>{t('editEmployee')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('employeeName')} *</Label>
              <Input
                value={editEmp.name}
                onChange={e => setEditEmp(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t('department')} *</Label>
              <Select value={editEmp.department_id} onValueChange={v => setEditEmp(f => ({ ...f, department_id: v ?? '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('leaveBalance')}</Label>
              <Input
                type="number"
                value={editEmp.leave_balance}
                onChange={e => setEditEmp(f => ({ ...f, leave_balance: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t('email')}</Label>
              <Input
                type="email"
                value={editEmp.email}
                onChange={e => setEditEmp(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t('phone')}</Label>
              <Input
                value={editEmp.phone}
                onChange={e => setEditEmp(f => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t('position')}</Label>
              <Input
                value={editEmp.position}
                onChange={e => setEditEmp(f => ({ ...f, position: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t('joinDate')}</Label>
              <Input
                type="date"
                value={editEmp.join_date}
                onChange={e => setEditEmp(f => ({ ...f, join_date: e.target.value }))}
              />
            </div>

            {/* Individual work schedule. Blank = follow the department. This matters
                because tardiness is measured against the start time and costs annual
                leave, so someone on different hours must not be judged by their
                department's schedule. */}
            <div className="pt-2 border-t space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-semibold">{t('workSchedule')}</Label>
                {!editSchedule.work_start_time && !editSchedule.work_days && !editSchedule.work_hours_per_day && (
                  <Badge variant="outline" className="text-[10px]">{t('inheritsDepartment')}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('employeeScheduleHint')}</p>
              <ScheduleFields
                value={editSchedule}
                onChange={patch => setEditSchedule(s => ({ ...s, ...patch }))}
                fallback={editEmpDeptSchedule}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleEditEmployee} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? '...' : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(c => ({ ...c, open }))}
        title={t('deleteEmployee')}
        description={`${t('areYouSure')} "${deleteConfirm.name}"?`}
        onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
