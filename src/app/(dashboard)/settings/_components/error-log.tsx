'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { useT } from '@/lib/language-context'

// Server errors, captured by `onRequestError` in src/instrumentation.ts.
// Before this, a production 500 only reached stdout — invisible unless someone happened
// to be tailing Railway logs at the moment it happened.

interface ErrorRow {
  id: number
  message: string
  stack: string | null
  path: string | null
  method: string | null
  source: string | null
  created_at: string
}

export function ErrorLog() {
  const t = useT()
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data, isLoading } = useQuery<{ rows: ErrorRow[]; total: number }>({
    queryKey: ['error-log'],
    queryFn: () => fetch('/api/errors?limit=50').then(r => (r.ok ? r.json() : { rows: [], total: 0 })),
  })

  const rows = data?.rows ?? []

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          {t('errorLog')}
          {(data?.total ?? 0) > 0 && (
            <Badge variant="outline" className="text-[10px]">{data?.total}</Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('errorLogHint')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noErrorsRecorded')}</p>
        ) : (
          rows.map(e => (
            <div key={e.id} className="p-3 rounded-xl bg-accent/20">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words">{e.message}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {new Date(e.created_at).toLocaleString(t('enUs'), { dateStyle: 'short', timeStyle: 'short' })}
                    {e.method || e.path ? ` · ${e.method || ''} ${e.path || ''}` : ''}
                    {e.source ? ` · ${e.source}` : ''}
                  </p>
                </div>
                {e.stack && (
                  <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                    {expanded === e.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                )}
              </div>
              {expanded === e.id && e.stack && (
                <pre className="mt-2 text-[10px] leading-relaxed overflow-x-auto bg-background/60 p-2 rounded-lg" dir="ltr">
                  {e.stack}
                </pre>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
