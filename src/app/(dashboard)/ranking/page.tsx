'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Trophy, Medal, Award, TrendingUp, TrendingDown } from 'lucide-react'
import { getEmployees, getLeaveRequests, getTardinessRecords, getSettings } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'

function formatMinutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function RankingPage() {
  const t = useT()
  const { lang } = useLanguage()
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const rankings = useMemo(() => {
    const activeEmps = employees.filter(e => e.is_active)
    if (!settings) return []

    const maxPossibleDays = settings.annual_leave_balance
    const workHoursPerDay = settings.work_hours_per_day

    return activeEmps.map(emp => {
      const empLeaves = leaves.filter(l => l.employee_id === emp.id && l.status === 'approved')
      const usedDays = empLeaves.reduce((sum, l) => sum + l.days_count, 0)
      const empTardiness = tardiness.filter(t => t.employee_id === emp.id)
      const tardMinutes = empTardiness.reduce((sum, t) => sum + t.minutes_late, 0)
      const tardCount = empTardiness.length

      // Commitment Score Formula:
      // Base: 100 points
      // Leave penalty: -(used_days / max_days) * 30 (max 30 points)
      // Tardiness penalty: -(tardiness_minutes / (work_hours * 60)) * 40 (max 40 points)
      // Frequency penalty: -(tard_count * 2) (max 30 points)
      const leavePenalty = Math.min(30, (usedDays / maxPossibleDays) * 30)
      const tardPenalty = Math.min(40, (tardMinutes / (workHoursPerDay * 60)) * 40)
      const freqPenalty = Math.min(30, tardCount * 2)

      const score = Math.max(0, Math.round(100 - leavePenalty - tardPenalty - freqPenalty))

      return {
        ...emp,
        usedDays,
        tardMinutes,
        tardCount,
        score,
        department: emp.department?.name || '',
      }
    }).sort((a, b) => b.score - a.score)
  }, [employees, leaves, tardiness, settings])

  function getScoreColor(score: number) {
    if (score >= 80) return 'text-[#4CAF50]'
    if (score >= 60) return 'text-[#FF9800]'
    return 'text-[#F44336]'
  }

  function getScoreBg(score: number) {
    if (score >= 80) return 'bg-[#4CAF50]/10'
    if (score >= 60) return 'bg-[#FF9800]/10'
    return 'bg-[#F44336]/10'
  }

  function getRankBadge(rank: number) {
    if (rank === 1) return <Trophy className="h-5 w-5 text-[#FFD700]" />
    if (rank === 2) return <Medal className="h-5 w-5 text-[#C0C0C0]" />
    if (rank === 3) return <Award className="h-5 w-5 text-[#CD7F32]" />
    return <span className="text-sm font-bold text-muted-foreground">{rank}</span>
  }

  // Top 3 podium
  const top3 = rankings.slice(0, 3)
  const rest = rankings.slice(3)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('commitmentRanking')}</h1>

      {/* Scoring Legend */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            {lang === 'ar'
              ? <><strong>معادلة الحساب:</strong> النتيجة الأساسية 100 نقطة - خصم الإجازات (حتى 30 نقطة) - خصم التأخير (حتى 40 نقطة) - تكرار التأخير (حتى 30 نقطة)</>
              : <><strong>Scoring Formula:</strong> Base 100 points - Leave penalty (up to 30) - Tardiness penalty (up to 40) - Frequency penalty (up to 30)</>
            }
          </p>
          <div className="flex gap-4 mt-2 text-sm">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#4CAF50]" /> 80+ {t('excellent')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#FF9800]" /> 60-79 {t('good')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#F44336]" /> &lt;60 {t('needsImprovement')}</span>
          </div>
        </CardContent>
      </Card>

      {/* Top 3 Podium */}
      {top3.length >= 3 && (
        <div className="grid grid-cols-3 gap-4">
          {[top3[1], top3[0], top3[2]].map((emp, visualIdx) => {
            const actualRank = visualIdx === 1 ? 1 : visualIdx === 0 ? 2 : 3
            const heights = ['h-32', 'h-40', 'h-28']
            return (
              <Card key={emp.id} className={`border-0 shadow-md flex flex-col items-center justify-end ${visualIdx === 1 ? 'order-1' : visualIdx === 0 ? 'order-0' : 'order-2'}`}>
                <CardContent className="p-4 text-center w-full">
                  <div className="mb-2">{getRankBadge(actualRank)}</div>
                  <div className={`mx-auto rounded-full w-14 h-14 flex items-center justify-center text-lg font-bold mb-2 ${getScoreBg(emp.score)} ${getScoreColor(emp.score)}`}>
                    {emp.score}
                  </div>
                  <p className="font-bold text-sm truncate">{emp.name}</p>
                  <p className="text-xs text-muted-foreground">{emp.department}</p>
                  <div className="flex justify-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{t('leaves')}: {emp.usedDays}</span>
                    <span>{t('tardiness')}: {emp.tardCount}</span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Full Rankings Table */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-lg">{t('fullRanking')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-center w-16">#</TableHead>
                <TableHead className="text-start">{t('name')}</TableHead>
                <TableHead className="text-center">{t('department')}</TableHead>
                <TableHead className="text-center">{t('leaves')}</TableHead>
                <TableHead className="text-center">{t('tardinessHHMM')}</TableHead>
                <TableHead className="text-center">{t('lateCount')}</TableHead>
                <TableHead className="text-center">{t('score')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rankings.map((emp, idx) => (
                <TableRow key={emp.id}>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center">
                      {getRankBadge(idx + 1)}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{emp.name}</TableCell>
                  <TableCell className="text-center">{emp.department}</TableCell>
                  <TableCell className="text-center">{emp.usedDays} {t('days')}</TableCell>
                  <TableCell className="text-center font-mono">{formatMinutesToHHMM(emp.tardMinutes)}</TableCell>
                  <TableCell className="text-center">{emp.tardCount}</TableCell>
                  <TableCell className="text-center">
                    <Badge className={`${getScoreBg(emp.score)} ${getScoreColor(emp.score)} border-0 font-bold text-sm`}>
                      {emp.score}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
