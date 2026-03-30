'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Users, CalendarOff, Wallet, Clock, TrendingUp, TrendingDown,
  ArrowUpLeft, ArrowDownRight, ChevronLeft, ChevronRight, AlertTriangle,
  CalendarDays, UserCheck, Timer
} from 'lucide-react'
import { getSettings, getEmployees, getLeaveRequests, getTardinessRecords, getLeaveTypes, getDepartments } from '@/lib/api'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { AnimatedCounter } from '@/components/animated-counter'
import { useLanguage, useT } from '@/lib/language-context'

function formatMinutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />
}

export default function DashboardPage() {
  const router = useRouter()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: employees = [], isLoading } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })

  const t = useT()
  const { lang, dir } = useLanguage()

  const today = new Date().toISOString().split('T')[0]
  const activeEmployees = employees.filter(e => e.is_active)

  const onLeaveToday = leaves.filter(l =>
    l.status === 'approved' && l.start_date <= today && l.end_date >= today
  )

  const pendingLeaves = leaves.filter(l => l.status === 'pending')

  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const monthTardiness = tardiness.filter(t => t.date >= monthStart)
  const totalTardMinutes = monthTardiness.reduce((sum, t) => sum + t.minutes_late, 0)

  const employeeStats = activeEmployees.map(emp => {
    const empLeaves = leaves.filter(l => l.employee_id === emp.id && l.status === 'approved')
    const usedDays = empLeaves.reduce((sum, l) => sum + l.days_count, 0)
    const empTardiness = tardiness.filter(t => t.employee_id === emp.id)
    const tardMinutes = empTardiness.reduce((sum, t) => sum + t.minutes_late, 0)
    const tardDays = settings ? tardMinutes / 60 / settings.work_hours_per_day : 0
    const remaining = emp.leave_balance - usedDays - tardDays
    const isOnLeave = empLeaves.some(l => l.start_date <= today && l.end_date >= today)
    return { ...emp, usedDays, tardMinutes, remaining: Math.round(remaining * 10) / 10, isOnLeave }
  })

  const avgRemaining = employeeStats.length > 0
    ? Math.round(employeeStats.reduce((sum, e) => sum + e.remaining, 0) / employeeStats.length * 10) / 10
    : 0

  // Leave by type for pie chart
  const leaveByType = leaveTypes.map(lt => {
    const totalDays = leaves
      .filter(l => l.leave_type_id === lt.id && l.status === 'approved')
      .reduce((sum, l) => sum + l.days_count, 0)
    return { name: lang === 'ar' ? lt.name_ar : lt.name_en, value: totalDays, color: lt.color }
  }).filter(lt => lt.value > 0)

  const totalLeaveDays = leaveByType.reduce((sum, l) => sum + l.value, 0)

  // Department data
  const deptData = departments.map(dept => {
    const deptEmps = employeeStats.filter(e => e.department_id === dept.id)
    const totalLeave = deptEmps.reduce((sum, e) => sum + e.usedDays, 0)
    const totalTard = Math.round(deptEmps.reduce((sum, e) => sum + e.tardMinutes, 0) / 60 * 10) / 10
    const deptOnLeave = onLeaveToday.filter(l => {
      const emp = employees.find(e => e.id === l.employee_id)
      return emp?.department_id === dept.id
    })
    const avgRem = deptEmps.length > 0
      ? Math.round(deptEmps.reduce((sum, e) => sum + e.remaining, 0) / deptEmps.length * 10) / 10
      : 0
    return {
      name: dept.name,
      count: deptEmps.length,
      leaves: totalLeave,
      tardiness: totalTard,
      onLeave: deptOnLeave.length,
      avgRemaining: avgRem,
    }
  })

  // Tardiness trend (last 7 records grouped by date)
  const tardDates = [...new Set(tardiness.map(t => t.date))].sort().slice(-7)
  const tardTrend = tardDates.map(date => {
    const dayRecords = tardiness.filter(t => t.date === date)
    const totalMin = dayRecords.reduce((sum, t) => sum + t.minutes_late, 0)
    return { date: date.slice(5), minutes: totalMin, count: dayRecords.length }
  })

  // Top 5 tardiness
  const topTardiness = [...employeeStats]
    .filter(e => e.tardMinutes > 0)
    .sort((a, b) => b.tardMinutes - a.tardMinutes)
    .slice(0, 5)

  // Employees on leave today details
  const onLeaveTodayDetails = onLeaveToday.map(l => {
    const emp = employees.find(e => e.id === l.employee_id)
    const lt = leaveTypes.find(t => t.id === l.leave_type_id)
    return {
      name: emp?.name || '',
      leaveType: lang === 'ar' ? (lt?.name_ar || '') : (lt?.name_en || ''),
      color: lt?.color || '#666',
      endDate: l.end_date,
    }
  })

  // Recent activity (last 5 leaves)
  const recentLeaves = leaves.slice(0, 5)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString(lang === 'ar' ? 'ar-OM' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {pendingLeaves.length > 0 && (
          <Button variant="outline" className="gap-2 border-[#FF9800]/30 text-[#FF9800] hover:bg-[#FF9800]/10" onClick={() => router.push('/leaves')}>
            <AlertTriangle className="h-4 w-4" />
            {pendingLeaves.length} {lang === 'ar' ? 'طلب معلق' : 'pending'}
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            title: t('totalEmployees'), value: activeEmployees.length,
            icon: Users, gradient: 'from-blue-500/20 to-blue-600/5',
            iconBg: 'bg-blue-500/15', iconColor: 'text-blue-500', valueColor: 'text-blue-500',
            sub: `${departments.length} ${lang === 'ar' ? 'أقسام' : 'depts'}`,
          },
          {
            title: t('onLeaveToday'), value: onLeaveToday.length,
            icon: CalendarOff, gradient: 'from-amber-500/20 to-amber-600/5',
            iconBg: 'bg-amber-500/15', iconColor: 'text-amber-500', valueColor: 'text-amber-500',
            sub: `${Math.round(onLeaveToday.length / Math.max(activeEmployees.length, 1) * 100)}%`,
          },
          {
            title: t('avgBalance'), value: avgRemaining,
            icon: Wallet, gradient: 'from-emerald-500/20 to-emerald-600/5',
            iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-500', valueColor: 'text-emerald-500',
            sub: `/ ${settings?.annual_leave_balance || 30} ${t('days')}`,
          },
          {
            title: t('monthTardiness'), value: formatMinutesToHHMM(totalTardMinutes),
            icon: Clock, gradient: 'from-rose-500/20 to-rose-600/5',
            iconBg: 'bg-rose-500/15', iconColor: 'text-rose-500', valueColor: 'text-rose-500',
            sub: `${monthTardiness.length} ${lang === 'ar' ? 'سجل' : 'records'}`,
          },
        ].map((kpi) => {
          const Icon = kpi.icon
          return (
            <Card key={kpi.title} className="border-0 shadow-lg overflow-hidden relative">
              <div className={`absolute inset-0 bg-gradient-to-br ${kpi.gradient} pointer-events-none`} />
              <CardContent className="p-5 relative">
                <div className="flex items-start justify-between">
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{kpi.title}</p>
                    <p className={`text-3xl font-extrabold ${kpi.valueColor}`}>
                      <AnimatedCounter value={kpi.value} />
                    </p>
                    <p className="text-xs text-muted-foreground">{kpi.sub}</p>
                  </div>
                  <div className={`rounded-xl p-2.5 ${kpi.iconBg}`}>
                    <Icon className={`h-5 w-5 ${kpi.iconColor}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Row 2: Charts + On Leave Today */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leave Distribution Donut */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('leaveByType')}</CardTitle>
          </CardHeader>
          <CardContent>
            {leaveByType.length > 0 ? (
              <div className="relative">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={leaveByType}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {leaveByType.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: '12px' }}
                      formatter={(value) => [`${value} ${t('days')}`, '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center text */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{totalLeaveDays}</p>
                    <p className="text-[10px] text-muted-foreground">{t('days')}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">{t('noData')}</div>
            )}
            {/* Legend */}
            <div className="space-y-2 mt-2">
              {leaveByType.map((lt, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lt.color }} />
                    <span className="text-muted-foreground">{lt.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{lt.value}</span>
                    <span className="text-[10px] text-muted-foreground w-8">
                      {Math.round(lt.value / Math.max(totalLeaveDays, 1) * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top Late Employees */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {t('tardinessRanking')}
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => router.push('/tardiness')}>
                {lang === 'ar' ? 'عرض الكل' : 'View all'} →
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {topTardiness.length > 0 ? (
              <div className="space-y-3">
                {topTardiness.map((emp, i) => {
                  const maxMinutes = Math.max(...topTardiness.map(e => e.tardMinutes), 1)
                  const percent = Math.round(emp.tardMinutes / maxMinutes * 100)
                  const empTardCount = tardiness.filter(t => t.employee_id === emp.id).length
                  return (
                    <div key={emp.id} className="space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          i === 0 ? 'bg-rose-500/20 text-rose-500' :
                          i === 1 ? 'bg-amber-500/20 text-amber-500' :
                          i === 2 ? 'bg-yellow-500/20 text-yellow-500' :
                          'bg-muted text-muted-foreground'
                        }`}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium truncate">{emp.name}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] text-muted-foreground">{empTardCount}x</span>
                              <span className="text-sm font-mono font-bold text-rose-500">{formatMinutesToHHMM(emp.tardMinutes)}</span>
                            </div>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                i === 0 ? 'bg-rose-500' : i === 1 ? 'bg-amber-500' : 'bg-yellow-500/70'
                              }`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {/* Summary row */}
                <div className="flex items-center justify-between pt-2 mt-2 border-t text-xs text-muted-foreground">
                  <span>{lang === 'ar' ? 'إجمالي الشهر' : 'Month total'}</span>
                  <span className="font-mono font-semibold text-foreground">{formatMinutesToHHMM(totalTardMinutes)}</span>
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                <UserCheck className="h-10 w-10 text-emerald-500/40" />
                <p className="text-sm">{lang === 'ar' ? 'لا يوجد تأخير' : 'No tardiness'}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* On Leave Today */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('onLeaveToday')}</CardTitle>
              <Badge variant="outline" className="text-amber-500 border-amber-500/30">{onLeaveTodayDetails.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {onLeaveTodayDetails.length > 0 ? (
              <div className="space-y-3">
                {onLeaveTodayDetails.map((emp, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-accent/30 hover:bg-accent/50 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-500 text-xs font-bold shrink-0">
                      {emp.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{emp.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: emp.color }} />
                        <span className="text-[11px] text-muted-foreground">{emp.leaveType}</span>
                        <span className="text-[11px] text-muted-foreground">→ {emp.endDate}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                <UserCheck className="h-10 w-10 text-emerald-500/40" />
                <p className="text-sm">{lang === 'ar' ? 'جميع الموظفين متواجدون' : 'All employees present'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Department Comparison + Employee Balance Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Comparison */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('deptComparison')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {deptData.map(dept => (
                <div key={dept.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{dept.name}</span>
                      <Badge variant="outline" className="text-[10px] h-5">{dept.count} {lang === 'ar' ? 'موظف' : 'emp'}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {dept.onLeave > 0 && (
                        <span className="text-amber-500">{dept.onLeave} {lang === 'ar' ? 'في إجازة' : 'on leave'}</span>
                      )}
                    </div>
                  </div>
                  {/* Leave bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{t('leaves')}</span>
                      <span className="font-medium">{dept.leaves} {t('days')}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.min(100, dept.leaves / Math.max(...deptData.map(d => d.leaves), 1) * 100)}%` }}
                      />
                    </div>
                  </div>
                  {/* Tardiness bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{t('tardinessHHMM')}</span>
                      <span className="font-medium">{dept.tardiness} {lang === 'ar' ? 'ساعة' : 'hrs'}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-rose-500 transition-all"
                        style={{ width: `${Math.min(100, dept.tardiness / Math.max(...deptData.map(d => d.tardiness), 1) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Employee Balance Overview */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('employeeLeaveSummary')}</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => router.push('/employees')}>
                {lang === 'ar' ? 'عرض الكل' : 'View all'} →
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {employeeStats.slice(0, 8).map((emp) => {
                const usedPercent = Math.round(emp.usedDays / Math.max(emp.leave_balance, 1) * 100)
                return (
                  <div key={emp.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition-colors cursor-pointer" onClick={() => router.push(`/employees/${emp.id}`)}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      emp.isOnLeave ? 'bg-amber-500/15 text-amber-500' : 'bg-accent text-muted-foreground'
                    }`}>
                      {emp.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">{emp.name}</span>
                        <span className={`text-xs font-semibold ${emp.remaining < 5 ? 'text-rose-500' : emp.remaining < 15 ? 'text-amber-500' : 'text-emerald-500'}`}>
                          {emp.remaining}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${usedPercent > 80 ? 'bg-rose-500' : usedPercent > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${usedPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Recent Activity + Quick Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <Card className="border-0 shadow-lg lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {lang === 'ar' ? 'آخر الإجازات' : 'Recent Leaves'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentLeaves.map((leave) => {
                const emp = employees.find(e => e.id === leave.employee_id)
                const lt = leaveTypes.find(t => t.id === leave.leave_type_id)
                return (
                  <div key={leave.id} className="flex items-center gap-3 p-3 rounded-xl bg-accent/20 hover:bg-accent/40 transition-colors">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: lt?.color + '20', color: lt?.color }}>
                      {emp?.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{emp?.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {lang === 'ar' ? lt?.name_ar : lt?.name_en} · {leave.start_date} → {leave.end_date} · {leave.days_count} {t('days')}
                      </p>
                    </div>
                    <Badge className={`shrink-0 border-0 text-[10px] ${
                      leave.status === 'approved' ? 'bg-emerald-500/10 text-emerald-500' :
                      leave.status === 'rejected' ? 'bg-rose-500/10 text-rose-500' :
                      'bg-amber-500/10 text-amber-500'
                    }`}>
                      {leave.status === 'approved' ? t('approved') : leave.status === 'rejected' ? t('rejected') : t('pending')}
                    </Badge>
                  </div>
                )
              })}
              {recentLeaves.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">{t('noLeaves')}</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {lang === 'ar' ? 'إحصائيات سريعة' : 'Quick Stats'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { label: lang === 'ar' ? 'إجمالي أيام الإجازات' : 'Total Leave Days', value: totalLeaveDays, icon: CalendarDays, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                { label: lang === 'ar' ? 'إجمالي سجلات التأخير' : 'Total Tardiness Records', value: tardiness.length, icon: Timer, color: 'text-rose-500', bg: 'bg-rose-500/10' },
                { label: lang === 'ar' ? 'طلبات معلقة' : 'Pending Requests', value: pendingLeaves.length, icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                { label: lang === 'ar' ? 'أقل رصيد' : 'Lowest Balance', value: employeeStats.length > 0 ? Math.min(...employeeStats.map(e => e.remaining)) : 0, icon: TrendingDown, color: 'text-rose-500', bg: 'bg-rose-500/10' },
                { label: lang === 'ar' ? 'أعلى رصيد' : 'Highest Balance', value: employeeStats.length > 0 ? Math.max(...employeeStats.map(e => e.remaining)) : 0, icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
              ].map((stat) => {
                const Icon = stat.icon
                return (
                  <div key={stat.label} className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${stat.bg}`}>
                      <Icon className={`h-4 w-4 ${stat.color}`} />
                    </div>
                    <div className="flex-1">
                      <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                      <p className="text-lg font-bold">{stat.value}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
