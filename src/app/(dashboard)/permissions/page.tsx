'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle, XCircle, Clock, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useT } from '@/lib/language-context'
import { getDepartments, getEmployees } from '@/lib/api'

export default function PermissionsPage() {
  const t = useT()
  const { lang, dir } = useLanguage()
  const queryClient = useQueryClient()
  const [deptFilter, setDeptFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const { data: permissions = [] } = useQuery({
    queryKey: ['permissions'],
    queryFn: () => fetch('/api/permissions').then(r => r.json()),
  })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })

  const approveMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      fetch(`/api/permissions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] })
      toast.success(t('updatedSuccess'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/permissions/${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] })
      toast.success(t('deletedSuccess'))
    },
  })

  const filtered = useMemo(() => {
    let data = permissions
    if (statusFilter !== 'all') data = data.filter((p: any) => p.status === statusFilter)
    if (deptFilter !== 'all') {
      const deptEmpIds = employees.filter((e: any) => e.department_id === parseInt(deptFilter)).map((e: any) => e.id)
      data = data.filter((p: any) => deptEmpIds.includes(p.employee_id))
    }
    return data
  }, [permissions, statusFilter, deptFilter, employees])

  // Stats
  const pendingCount = permissions.filter((p: any) => p.status === 'pending').length
  const todayCount = permissions.filter((p: any) => p.date === new Date().toISOString().split('T')[0]).length

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

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('permissions')}</h1>
          {pendingCount > 0 && (
            <p className="text-sm text-amber-500 mt-1">{pendingCount} {lang === 'ar' ? 'طلب معلق' : 'pending requests'}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v ?? 'all')}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{lang === 'ar' ? 'كل الحالات' : 'All Status'}</SelectItem>
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
              {departments.map((d: any) => (
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
            <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'اليوم' : 'Today'}</p>
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
            <p className="text-2xl font-bold text-emerald-500">{permissions.filter((p: any) => p.status === 'approved').length}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'لم يعودوا' : 'Not Returned'}</p>
            <p className="text-2xl font-bold text-rose-500">{permissions.filter((p: any) => p.status === 'approved' && !p.return_time).length}</p>
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
                  <TableHead className="text-center">{lang === 'ar' ? 'وقت الخروج' : 'Left At'}</TableHead>
                  <TableHead className="text-center">{lang === 'ar' ? 'وقت العودة' : 'Returned'}</TableHead>
                  <TableHead className="text-center">{lang === 'ar' ? 'المدة' : 'Duration'}</TableHead>
                  <TableHead className="text-start">{lang === 'ar' ? 'السبب' : 'Reason'}</TableHead>
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
                  filtered.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.employee?.name}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{p.date}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{p.leave_time?.slice(0, 5)}</TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {p.return_time ? p.return_time.slice(0, 5) : (
                          <span className="text-rose-500 text-xs">{lang === 'ar' ? 'لم يعد' : 'Not yet'}</span>
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
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {p.status === 'pending' && (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-500 hover:bg-emerald-500/10"
                                onClick={() => approveMutation.mutate({ id: p.id, status: 'approved' })}>
                                <CheckCircle className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:bg-rose-500/10"
                                onClick={() => approveMutation.mutate({ id: p.id, status: 'rejected' })}>
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:bg-rose-500/10"
                            onClick={() => deleteMutation.mutate(p.id)}>
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
    </div>
  )
}
