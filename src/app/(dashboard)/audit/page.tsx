'use client'

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Download, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useT } from '@/lib/language-context'
import { exportToExcel } from '@/lib/excel'

interface AuditEntry {
  id: number
  action: string
  user_id: string
  user_role: string
  details: string
  created_at: string
}

interface AuditResponse {
  rows: AuditEntry[]
  total: number
  limit: number
  offset: number
  truncated: boolean
  actions: string[]
  roles: string[]
}

const PAGE_SIZE = 50
const EMPTY: AuditResponse = { rows: [], total: 0, limit: PAGE_SIZE, offset: 0, truncated: false, actions: [], roles: [] }

export default function AuditPage() {
  const t = useT()
  const { lang, dir } = useLanguage()

  const [actionFilter, setActionFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)

  // Filtering happens in SQL, so a query is built from the filters rather than the
  // results being whittled down client-side.
  const params = useMemo(() => {
    const sp = new URLSearchParams()
    if (actionFilter !== 'all') sp.set('action', actionFilter)
    if (roleFilter !== 'all') sp.set('role', roleFilter)
    if (search.trim()) sp.set('q', search.trim())
    if (from) sp.set('from', from)
    if (to) sp.set('to', to)
    return sp
  }, [actionFilter, roleFilter, search, from, to])

  const { data = EMPTY, isFetching } = useQuery<AuditResponse>({
    queryKey: ['audit', params.toString(), page],
    queryFn: () => {
      const sp = new URLSearchParams(params)
      sp.set('limit', String(PAGE_SIZE))
      sp.set('offset', String(page * PAGE_SIZE))
      return fetch(`/api/audit?${sp}`).then(r => (r.ok ? r.json() : EMPTY))
    },
    placeholderData: keepPreviousData,
  })

  const hasFilters = actionFilter !== 'all' || roleFilter !== 'all' || !!search.trim() || !!from || !!to
  const firstShown = data.total === 0 ? 0 : page * PAGE_SIZE + 1
  const lastShown = page * PAGE_SIZE + data.rows.length
  const canPrev = page > 0
  const canNext = lastShown < data.total

  function resetFilters() {
    setActionFilter('all')
    setRoleFilter('all')
    setSearch('')
    setFrom('')
    setTo('')
    setPage(0)
  }

  function onFilterChange(fn: () => void) {
    fn()
    setPage(0) // a new filter invalidates the current page number
  }

  // Export the whole FILTERED set, not just the visible page — exporting one page of a
  // filtered search is almost never what someone wants from an audit log.
  async function handleExport() {
    const sp = new URLSearchParams(params)
    sp.set('export', '1')
    const res = await fetch(`/api/audit?${sp}`)
    if (!res.ok) {
      toast.error(t('error'))
      return
    }
    const payload: AuditResponse = await res.json()
    if (payload.rows.length === 0) {
      toast.error(t('noData'))
      return
    }
    exportToExcel(
      payload.rows.map(r => ({
        [t('action')]: r.action,
        [t('user')]: r.user_id,
        [t('role')]: r.user_role,
        [t('details')]: r.details,
        [t('date')]: new Date(r.created_at).toISOString(),
      })),
      `audit-log-${new Date().toISOString().slice(0, 10)}`,
      t('auditLog2')
    )
    if (payload.truncated) {
      // Never let a capped export masquerade as a complete one.
      toast.warning(
        lang === 'ar'
          ? `تم تصدير ${payload.rows.length} من أصل ${payload.total} سجل — استخدم فلتر تاريخ أضيق لتصدير الباقي.`
          : `Exported ${payload.rows.length} of ${payload.total} entries — narrow the date range to export the rest.`
      )
    } else {
      toast.success(t('savedSuccess'))
    }
  }

  function getActionBadge(action: string) {
    if (action.includes('approved') || action.includes('change')) return 'bg-emerald-500/10 text-emerald-500'
    if (action.includes('reset') || action.includes('delete')) return 'bg-rose-500/10 text-rose-500'
    if (action.includes('daily') || action.includes('yearly')) return 'bg-amber-500/10 text-amber-500'
    return 'bg-blue-500/10 text-blue-500'
  }

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t('auditLog2')}</h1>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4 mr-1.5" />
          {t('exportExcel')}
        </Button>
      </div>

      <Card className="border-0 shadow-md">
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">{t('search2')}</label>
            <Input
              value={search}
              onChange={e => onFilterChange(() => setSearch(e.target.value))}
              placeholder={t('searchAuditPlaceholder')}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('action')}</label>
            <Select value={actionFilter} onValueChange={v => onFilterChange(() => setActionFilter(v ?? 'all'))}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allActions')}</SelectItem>
                {data.actions.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('role')}</label>
            <Select value={roleFilter} onValueChange={v => onFilterChange(() => setRoleFilter(v ?? 'all'))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allRoles')}</SelectItem>
                {data.roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('fromDate')}</label>
            <Input type="date" value={from} onChange={e => onFilterChange(() => setFrom(e.target.value))} className="w-40" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('toDate')}</label>
            <Input type="date" value={to} onChange={e => onFilterChange(() => setTo(e.target.value))} className="w-40" />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="h-4 w-4 mr-1" />
              {t('clearFilters')}
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-2">
        <span>
          {data.total === 0
            ? t('noData')
            : lang === 'ar'
              ? `عرض ${firstShown}–${lastShown} من ${data.total}`
              : `Showing ${firstShown}–${lastShown} of ${data.total}`}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!canPrev || isFetching} onClick={() => setPage(p => Math.max(0, p - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={!canNext || isFetching} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-12">#</TableHead>
                  <TableHead className="text-start">{t('action')}</TableHead>
                  <TableHead className="text-center">{t('user')}</TableHead>
                  <TableHead className="text-center">{t('role')}</TableHead>
                  <TableHead className="text-start">{t('details')}</TableHead>
                  <TableHead className="text-center">{t('date')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('noData')}</TableCell>
                  </TableRow>
                ) : (
                  data.rows.map((log, idx) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-center text-muted-foreground">{page * PAGE_SIZE + idx + 1}</TableCell>
                      <TableCell>
                        <Badge className={`${getActionBadge(log.action)} border-0`}>{log.action}</Badge>
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">@{log.user_id}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">{log.user_role}</Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[400px] break-words">{log.details}</TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString(t('enUs'), { dateStyle: 'short', timeStyle: 'short' })}
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
