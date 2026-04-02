'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Search, ArrowUpDown, Plus, Trash2, Pencil, Upload } from 'lucide-react'
import { getEmployees, getLeaveRequests, getTardinessRecords, getSettings, getDepartments, getLeaveTypes, createEmployee, deleteEmployee, updateEmployee } from '@/lib/api'
import { parseExcelFile } from '@/lib/excel'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useLanguage, useT } from '@/lib/language-context'

function formatMinutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

type SortField = 'name' | 'department' | 'balance' | 'used' | 'remaining' | 'tardiness' | 'deduction'
type SortDir = 'asc' | 'desc'

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
  const [newEmp, setNewEmp] = useState({ name: '', department_id: '', leave_balance: '30' })

  const createMutation = useMutation({
    mutationFn: createEmployee,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setAddOpen(false)
      setNewEmp({ name: '', department_id: '', leave_balance: '30' })
      toast.success(t('addedSuccess'))
    },
    onError: () => toast.error(t('error')),
  })

  const [editOpen, setEditOpen] = useState(false)
  const [editEmp, setEditEmp] = useState({ id: 0, name: '', department_id: '', leave_balance: '' })
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number; name: string }>({ open: false, id: 0, name: '' })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<any> }) => updateEmployee(id, data),
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
        leave_balance: parseInt(editEmp.leave_balance) || 30,
      },
    })
  }

  function openEditDialog(emp: any) {
    setEditEmp({
      id: emp.id,
      name: emp.name,
      department_id: String(emp.department_id),
      leave_balance: String(emp.leave_balance),
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
      leave_balance: parseInt(newEmp.leave_balance) || 30,
    })
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const data = await parseExcelFile(file)
      let imported = 0
      for (const row of data) {
        const name = row['Name'] || row['name'] || row['الاسم']
        const deptName = row['Department'] || row['department'] || row['القسم']
        const balance = row['Leave Balance'] || row['leave_balance'] || row['الرصيد'] || 30

        if (!name) continue

        // Find department by name
        const dept = departments.find(d => d.name === deptName)
        const deptId = dept?.id || departments[0]?.id

        if (deptId) {
          await fetch('/api/employees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, department_id: deptId, leave_balance: parseInt(balance) || 30 }),
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

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })

  const today = new Date().toISOString().split('T')[0]

  const employeeRows = useMemo(() => {
    return employees.filter(e => e.is_active).map((emp, idx) => {
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
      const tardDays = settings ? tardMinutes / 60 / settings.work_hours_per_day : 0
      const remaining = emp.leave_balance
      const deduction = settings ? Math.round(tardMinutes / 60 * settings.deduction_per_hour * 1000) / 1000 : 0

      const isOnLeave = empLeaves.some(l => l.start_date <= today && l.end_date >= today)

      return {
        ...emp,
        index: idx + 1,
        departmentName: emp.department?.name || '',
        usedDays,
        byType,
        tardMinutes,
        remaining,
        deduction,
        isOnLeave,
      }
    })
  }, [employees, leaves, tardiness, settings, leaveTypes, today])

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
        case 'deduction': cmp = a.deduction - b.deduction; break
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

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead
      className="text-center cursor-pointer select-none hover:bg-accent"
      onClick={() => toggleSort(field)}
    >
      <div className="flex items-center justify-center gap-1">
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </div>
    </TableHead>
  )

  return (
    <div className="space-y-6">
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
                  <SortHeader field="name">{t('name')}</SortHeader>
                  <SortHeader field="department">{t('department')}</SortHeader>
                  <SortHeader field="balance">{t('balance')}</SortHeader>
                  <SortHeader field="used">{t('used')}</SortHeader>
                  <TableHead className="text-center">{t('annual')}</TableHead>
                  <TableHead className="text-center">{t('sick')}</TableHead>
                  <TableHead className="text-center">{t('emergency')}</TableHead>
                  <TableHead className="text-center">{t('unpaid')}</TableHead>
                  <TableHead className="text-center">{t('other')}</TableHead>
                  <SortHeader field="remaining">{t('remaining')}</SortHeader>
                  <SortHeader field="tardiness">{t('tardinessHHMM')}</SortHeader>
                  <TableHead className="text-center">{t('status')}</TableHead>
                  <SortHeader field="deduction">{t('deduction')} ({settings?.currency_symbol || 'ر.ع.'})</SortHeader>
                  <TableHead className="text-center w-20">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((emp) => (
                  <TableRow
                    key={emp.id}
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => router.push(`/employees/${emp.id}`)}
                  >
                    <TableCell className="text-center">{emp.index}</TableCell>
                    <TableCell className="font-medium">{emp.name}</TableCell>
                    <TableCell className="text-center">{emp.departmentName}</TableCell>
                    <TableCell className="text-center">{emp.leave_balance}</TableCell>
                    <TableCell className="text-center">{emp.usedDays}</TableCell>
                    <TableCell className="text-center">{emp.byType['Annual'] || 0}</TableCell>
                    <TableCell className="text-center">{emp.byType['Sick'] || 0}</TableCell>
                    <TableCell className="text-center">{emp.byType['Emergency'] || 0}</TableCell>
                    <TableCell className="text-center">{emp.byType['Unpaid'] || 0}</TableCell>
                    <TableCell className="text-center">{emp.byType['Other'] || 0}</TableCell>
                    <TableCell className="text-center font-bold">
                      <span className={emp.remaining < 5 ? 'text-[#F44336]' : ''}>
                        {emp.remaining}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">{formatMinutesToHHMM(emp.tardMinutes)}</TableCell>
                    <TableCell className="text-center">
                      {emp.isOnLeave ? (
                        <Badge variant="outline" className="bg-[#FF9800]/10 text-[#FF9800] border-[#FF9800]/30">
                          {t('onLeave')} 🏖️
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-[#4CAF50]/10 text-[#4CAF50] border-[#4CAF50]/30">
                          {t('available')} ✅
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{emp.deduction.toFixed(3)}</TableCell>
                    <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
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
