'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLanguage, useT } from '@/lib/language-context'

export default function AuditPage() {
  const t = useT()
  const { lang, dir } = useLanguage()
  const [actionFilter, setActionFilter] = useState<string>('all')

  const { data: logs = [] } = useQuery({
    queryKey: ['audit'],
    queryFn: () => fetch('/api/audit').then(r => r.ok ? r.json() : []),
  })

  const filtered = actionFilter === 'all' ? logs : logs.filter((l: any) => l.action === actionFilter)
  const actions = [...new Set(logs.map((l: any) => l.action))] as string[]

  function getActionBadge(action: string) {
    if (action.includes('approved') || action.includes('change')) return 'bg-emerald-500/10 text-emerald-500'
    if (action.includes('reset') || action.includes('delete')) return 'bg-rose-500/10 text-rose-500'
    if (action.includes('daily') || action.includes('yearly')) return 'bg-amber-500/10 text-amber-500'
    return 'bg-blue-500/10 text-blue-500'
  }

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{lang === 'ar' ? '\u0633\u062c\u0644 \u0627\u0644\u0645\u0631\u0627\u062c\u0639\u0629' : 'Audit Log'}</h1>
        <Select value={actionFilter} onValueChange={v => setActionFilter(v ?? 'all')}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{lang === 'ar' ? '\u0643\u0644 \u0627\u0644\u0623\u062d\u062f\u0627\u062b' : 'All Actions'}</SelectItem>
            {actions.map(a => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-12">#</TableHead>
                  <TableHead className="text-start">{lang === 'ar' ? '\u0627\u0644\u062d\u062f\u062b' : 'Action'}</TableHead>
                  <TableHead className="text-center">{lang === 'ar' ? '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645' : 'User'}</TableHead>
                  <TableHead className="text-center">{lang === 'ar' ? '\u0627\u0644\u062f\u0648\u0631' : 'Role'}</TableHead>
                  <TableHead className="text-start">{lang === 'ar' ? '\u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644' : 'Details'}</TableHead>
                  <TableHead className="text-center">{t('date')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('noData')}</TableCell>
                  </TableRow>
                ) : (
                  filtered.map((log: any, idx: number) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-center text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        <Badge className={`${getActionBadge(log.action)} border-0`}>{log.action}</Badge>
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">@{log.user_id}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">{log.user_role}</Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[300px] truncate">{log.details}</TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString(lang === 'ar' ? 'ar-OM' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
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
