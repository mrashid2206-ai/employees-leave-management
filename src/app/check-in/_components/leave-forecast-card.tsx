'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingDown, CalendarClock, Hourglass, AlertTriangle } from 'lucide-react'
import { useLanguage, useT } from '@/lib/language-context'
import { useLeaveForecast } from '../_hooks/use-portal'

// Balances reset clean at the start of each fiscal year -- unused days are NOT carried
// over. Showing only "you have N days" hides the deadline, so this card leads with what
// expires and when.

const STATUS_STYLES: Record<string, string> = {
  negative: 'bg-red-500/10 text-red-500',
  critical: 'bg-red-500/10 text-red-500',
  tight: 'bg-amber-500/10 text-amber-500',
  healthy: 'bg-emerald-500/10 text-emerald-500',
}

export function LeaveForecastCard({ empId }: { empId?: number }) {
  const t = useT()
  const { lang } = useLanguage()
  const { data: f, isLoading } = useLeaveForecast(empId)

  if (isLoading || !f) return null

  const statusLabel = {
    negative: t('forecastNegative'),
    critical: t('forecastCritical'),
    tight: t('forecastTight'),
    healthy: t('forecastHealthy'),
  }[f.status]

  const weeksLeft = Math.floor(f.daysLeftInYear / 7)

  return (
    <Card className="border-0 shadow-md">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              {t('leaveForecast')}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lang === 'ar'
                ? `تنتهي السنة في ${f.fiscalYearEnd} — متبقٍ ${f.daysLeftInYear} يوم (${weeksLeft} أسبوع)`
                : `Year ends ${f.fiscalYearEnd} — ${f.daysLeftInYear} days (${weeksLeft} weeks) left`}
            </p>
          </div>
          <Badge className={`${STATUS_STYLES[f.status]} border-0`}>{statusLabel}</Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('currentBalance')}</p>
            <p className="text-lg font-bold">{f.currentBalance}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('bookedUpcoming')}</p>
            <p className="text-lg font-bold">{f.approvedUpcomingDays}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('awaitingApproval')}</p>
            <p className="text-lg font-bold">{f.pendingDays}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('ifAllApproved')}</p>
            <p className="text-lg font-bold">{f.projectedBalance}</p>
          </div>
        </div>

        {f.tardinessDeductedYtd > 0 && (
          <div className="flex items-start gap-2 text-xs p-3 rounded-lg bg-amber-500/5">
            <TrendingDown className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              {lang === 'ar'
                ? `فقدت ${f.tardinessDeductedYtd} يوم بسبب التأخير حتى الآن. بهذا المعدل ستفقد نحو ${f.tardinessProjectedYearEnd} يوم بنهاية السنة.`
                : `You have lost ${f.tardinessDeductedYtd} days to tardiness so far. At this rate that becomes about ${f.tardinessProjectedYearEnd} days by year end.`}
            </p>
          </div>
        )}

        {f.status === 'negative' ? (
          <div className="flex items-start gap-2 text-xs p-3 rounded-lg bg-red-500/5">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-muted-foreground">{t('forecastNoBalanceHint')}</p>
          </div>
        ) : f.expiringDays > 0 ? (
          <div className="flex items-start gap-2 text-xs p-3 rounded-lg bg-primary/5">
            <Hourglass className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              {lang === 'ar'
                ? `إذا لم تأخذ إجازة أخرى، ستفقد ${f.expiringDays} يوم عند تجديد السنة — الرصيد لا يُرحَّل.`
                : `If you take no more leave, ${f.expiringDays} days expire at the yearly reset — balances do not carry over.`}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
