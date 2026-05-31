'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/language-context'

// Visible failure state for data fetches so a network error is no longer
// indistinguishable from an empty list.
export function QueryError({ onRetry }: { onRetry?: () => void }) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-600">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {t('loadError')}
      </span>
      {onRetry && (
        <Button variant="outline" size="sm" className="h-7" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          {t('retry')}
        </Button>
      )}
    </div>
  )
}
