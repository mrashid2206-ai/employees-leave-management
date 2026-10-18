'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { omanToday } from '@/lib/oman-date'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle, XCircle, Trash2, FileSpreadsheet } from 'lucide-react'
import { QueryError } from '@/components/query-error'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DecisionDialog } from '@/components/decision-dialog'
import { DecisionTrace } from '@/components/decision-trace'
import { useLanguage, useT } from '@/lib/language-context'
import { qk } from '@/lib/query-keys'
import { decidePermission, getDepartments, getEmployees, getPermissions, deletePermission, type Permission } from '@/lib/api'
import { exportToExcel } from '@/lib/excel'
import type { Employee, Department } from '@/lib/types'


export default function PermissionsPage() {
  const t = useT()
  const { dir } = useLanguage()
  const queryClient = useQueryClient()
  const [deptFilter, setDeptFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const { data: permissions = [], isError, refetch } = useQuery({
    queryKey: qk.permissions(),
    queryFn: () => getPermissions(),
  })
  const { data: departments = [] } = useQuery({ queryKey: qk.departments(), queryFn: getDepartments })
  const { data: employees = [] } = useQuery({ queryKey: qk.employees(), queryFn: getEmployees })

  // The response used to be parsed and treated as success whatever its status, so a
  // refused decision still showed "updated".
  const [rejectTarget, setRejectTarget] = useState<Permission | null>(null)
  const approveMutation = useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: 'approved' | 'rejected'; note?: string }) =>
      decidePermission(id, status, note || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.permissions() })
      setRejectTarget(null)
      toast.success(t('updatedSuccess'))
    },
    onError: (err: Error) => {
      // e.g. another admin already decided it: refresh so the row shows the real state.
      queryClient.invalidateQueries({ queryKey: qk.permissions() })
      toast.error(err.message || t('error'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deletePermission,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.permissions() })
      toast.success(t('deletedSuccess'))
    },
    onError: (err: Error) => toast.error(err.message || t('error')),
  })
  // A delete was one click on a small icon next to approve/reject, with no way back.
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number; name: string; date: string }>({ open: false, id: 0, name: '', date: '' })

  const filtered = useMemo(() => {
    let data = permissions
    if (statusFilter !== 'all') data = data.filter((p) => p.status === statusFilter)
    if (deptFilter !== 'all') {
      const deptEmpIds = employees.filter((e: Employee) => e.department_id === parseInt(deptFilter)).map((e: Employee) => e.id)
      data = data.filter((p) => deptEmpIds.includes(p.employee_id))
    }
    return data
  }, [permissions, statusFilter, deptFilter, employees])

  // Stats
  const pendingCount = permissions.filter((p) => p.status === 'pending').length
  const todayCount = permissions.filter((p) => p.date === omanToday()).length

  function calcAbsentHours(leaveTime: string, returnTime: string | null): string {
    if (!returnTime) return '-'
    const [lh, lm] = leaveTime.split(':').map(Number)
    const [rh, rm] = returnTime.split(':').map(Number)
    const mins = (rh * 60 + rm) - (lh * 60 + lm)
    if (mins <= 0) return '-'
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}h ${m}m`
  }

  const statusLabel = (status: string) =>
    status === 'approved' ? t('approved') : status === 'rejected' ? t('rejected') : t('pending')

  // The list as filtered on screen, not the whole table.
  function handleExport() {
    const data = filtered.map(p => ({
      [t('name')]: p.employee?.name || '',
      [t('date')]: p.date,
      [t('leftAt')]: p.leave_time?.slice(0, 5) || '',
      [t('returned')]: p.return_time?.slice(0, 5) || '',
      [t('duration')]: calcAbsentHours(p.leave_time, p.return_time),
      [t('reason')]: p.reason || '',
      [t('status')]: statusLabel(p.status),
    }))
    exportToExcel(data, `permissions-${omanToday()}`, t('permissions'))
  }

  return (
    <div className="space-y-6" dir={dir}>
      {isError && <QueryError onRetry={() => refetch()} />}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('permissions')}</h1>
          {pendingCount > 0 && (
            <p className="text-sm text-amber-500 mt-1">{pendingCount} {t('pendingRequests2')}</p>
          )}
        </div>
        <div className="flex gap-3 flex-wrap">
          <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
            <FileSpreadsheet className="h-4 w-4 me-2" />
            {t('exportExcel')}
          </Button>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v ?? 'all')}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allStatus')}</SelectItem>
              <SelectItem value="pending">{t('pending')}</SelectItem>
              <SelectItem value="approved">{t('approved')}</SelectItem>
              <SelectItem value="rejected">{t('rejected')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={v => setDeptFilter(v ?? 'all')}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allDepts')}</SelectItem>
              {departments.map((d: Department) => (
                <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{t('today')}</p>
            <p className="text-2xl font-bold">{todayCount}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{t('pending')}</p>
            <p className="text-2xl font-bold text-amber-500">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{t('approved')}</p>
            <p className="text-2xl font-bold text-emerald-500">{permissions.filter((p) => p.status === 'approved').length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{t('notReturned')}</p>
            <p className="text-2xl font-bold text-rose-500">{permissions.filter((p) => p.status === 'approved' && !p.return_time).length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t('name')}</TableHead>
                  <TableHead className="text-center">{t('date')}</TableHead>
                  <TableHead className="text-center">{t('leftAt')}</TableHead>
                  <TableHead className="text-center">{t('returned')}</TableHead>
                  <TableHead className="text-center">{t('duration')}</TableHead>
                  <TableHead className="text-start">{t('reason')}</TableHead>
                  <TableHead className="text-center">{t('status')}</TableHead>
                  <TableHead className="text-center">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t('noData')}</TableCell>
                  </TableRow>
                ) : (
                  filtered.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.employee?.name}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{p.date}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{p.leave_time?.slice(0, 5)}</TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {p.return_time ? p.return_time.slice(0, 5) : (
                          <span className="text-rose-500 text-xs">{t('notYet')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-sm">{calcAbsentHours(p.leave_time, p.return_time)}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{p.reason || '-'}</TableCell>
                      <TableCell className="text-center">
                        {p.status === 'approved' ? (
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-0">{t('approved')}</Badge>
                        ) : p.status === 'rejected' ? (
                          <Badge className="bg-rose-500/10 text-rose-500 border-0">{t('rejected')}</Badge>
                        ) : (
                          <Badge className="bg-amber-500/10 text-amber-500 border-0">{t('pending')}</Badge>
                        )}
                        <DecisionTrace
                          status={p.status}
                          reviewed_by={p.approved_by}
                          reviewed_at={p.reviewed_at}
                          decision_note={p.decision_note}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {p.status === 'pending' && (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-500 hover:bg-emerald-500/10"
                                aria-label={t('approve')}
                                disabled={approveMutation.isPending}
                                onClick={() => approveMutation.mutate({ id: p.id, status: 'approved' })}>
                                <CheckCircle className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:bg-rose-500/10"
                                aria-label={t('reject')}
                                disabled={approveMutation.isPending}
                                onClick={() => setRejectTarget(p)}>
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:bg-rose-500/10"
                            onClick={() => setDeleteConfirm({ open: true, id: p.id, name: p.employee?.name || '', date: p.date })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {rejectTarget && (
        <DecisionDialog
          key={rejectTarget.id}
          open
          onOpenChange={open => { if (!open) setRejectTarget(null) }}
          mode="reject"
          description={
            <span dir="auto">
              {rejectTarget.employee?.name} · <span className="font-mono" dir="ltr">{rejectTarget.date} {rejectTarget.leave_time?.slice(0, 5)}</span>
            </span>
          }
          loading={approveMutation.isPending}
          onConfirm={note => approveMutation.mutate({ id: rejectTarget.id, status: 'rejected', note })}
        />
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(c => ({ ...c, open }))}
        title={t('deletePermission')}
        description={t('deletePermissionConfirm', { name: deleteConfirm.name, date: deleteConfirm.date })}
        onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
