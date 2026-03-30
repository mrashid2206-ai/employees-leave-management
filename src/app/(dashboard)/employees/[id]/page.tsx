'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { ArrowRight, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { getEmployee, getLeaveRequestsByEmployee, getTardinessByEmployee, getSettings, getLeaveTypes } from '@/lib/api'
import { format } from 'date-fns'
import { useLanguage, useT } from '@/lib/language-context'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function formatMinutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function EmployeeCardPage() {
  const params = useParams()
  const router = useRouter()
  const t = useT()
  const { dir, lang } = useLanguage()
  const id = Number(params.id)

  const { data: employee } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => getEmployee(id),
  })
  const { data: leaves = [] } = useQuery({
    queryKey: ['employee-leaves', id],
    queryFn: () => getLeaveRequestsByEmployee(id),
  })
  const { data: tardiness = [] } = useQuery({
    queryKey: ['employee-tardiness', id],
    queryFn: () => getTardinessByEmployee(id),
  })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })

  if (!employee) return <div className="p-6">{t('loading')}</div>

  const today = new Date().toISOString().split('T')[0]
  const approvedLeaves = leaves.filter(l => l.status === 'approved')
  const usedDays = approvedLeaves.reduce((sum, l) => sum + l.days_count, 0)
  const tardMinutes = tardiness.reduce((sum, t) => sum + t.minutes_late, 0)
  const tardDays = settings ? tardMinutes / 60 / settings.work_hours_per_day : 0
  const remaining = Math.round((employee.leave_balance - usedDays - tardDays) * 10) / 10
  const deduction = settings ? Math.round(tardMinutes / 60 * settings.deduction_per_hour * 1000) / 1000 : 0
  const isOnLeave = approvedLeaves.some(l => l.start_date <= today && l.end_date >= today)

  // Leave breakdown by type
  const leaveBreakdown = leaveTypes.map(lt => ({
    ...lt,
    days: approvedLeaves
      .filter(l => l.leave_type_id === lt.id)
      .reduce((sum, l) => sum + l.days_count, 0)
  })).filter(lt => lt.days > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/employees')} className="no-print">
            <ArrowRight className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">{t('employeeCard')}</h1>
        </div>
        <Button variant="outline" onClick={() => window.print()} className="no-print">
          <Printer className="h-4 w-4 ml-2" />
          {t('print')}
        </Button>
      </div>

      {/* Employee Header Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold">{employee.name}</h2>
                {isOnLeave ? (
                  <Badge className="bg-[#FF9800]/10 text-[#FF9800] border-[#FF9800]/30">{t('onLeave')} 🏖️</Badge>
                ) : (
                  <Badge className="bg-[#4CAF50]/10 text-[#4CAF50] border-[#4CAF50]/30">{t('available')} ✅</Badge>
                )}
              </div>
              <p className="text-muted-foreground">{t('department')}: {employee.department?.name}</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg bg-[#1976D2]/10">
                <p className="text-sm text-muted-foreground">{t('balance')}</p>
                <p className="text-xl font-bold text-[#1976D2]">{employee.leave_balance}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-[#FF9800]/10">
                <p className="text-sm text-muted-foreground">{t('used')}</p>
                <p className="text-xl font-bold text-[#FF9800]">{usedDays}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-[#4CAF50]/10">
                <p className="text-sm text-muted-foreground">{t('remaining')}</p>
                <p className="text-xl font-bold text-[#4CAF50]">{remaining}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-[#F44336]/10">
                <p className="text-sm text-muted-foreground">{t('tardinessHHMM')}</p>
                <p className="text-xl font-bold text-[#F44336]">{formatMinutesToHHMM(tardMinutes)}</p>
              </div>
            </div>
          </div>

          {/* Leave breakdown by type */}
          {leaveBreakdown.length > 0 && (
            <div className="mt-4 flex gap-3 flex-wrap">
              {leaveBreakdown.map(lt => (
                <div key={lt.id} className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lt.color }} />
                  <span>{lang === 'ar' ? lt.name_ar : lt.name_en}: {lt.days} {t('days')}</span>
                </div>
              ))}
            </div>
          )}

          {/* Credentials */}
          <div className="mt-4 p-3 rounded-lg bg-accent/30">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">{t('username')}: </span>
                <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{(employee as any).username || '-'}</code>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await fetch(`/api/employees/${id}/reset-password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: '123456' }),
                  })
                  toast.success(lang === 'ar' ? 'تم إعادة تعيين كلمة المرور إلى 123456' : 'Password reset to 123456')
                }}
              >
                {lang === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset Password'}
              </Button>
            </div>
          </div>

          {deduction > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('deduction')}: {deduction.toFixed(3)} {settings?.currency_symbol}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Monthly Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Tardiness Chart */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {lang === 'ar' ? 'التأخير الشهري' : 'Monthly Tardiness'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const monthlyTard: Record<string, number> = {}
              tardiness.forEach(t => {
                const month = t.date.slice(0, 7)
                monthlyTard[month] = (monthlyTard[month] || 0) + t.minutes_late
              })
              const chartData = Object.entries(monthlyTard)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([month, minutes]) => ({ month: month.slice(5), minutes }))

              return chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} width={30} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                      formatter={(value) => [`${value} ${lang === 'ar' ? 'دقيقة' : 'min'}`, '']}
                    />
                    <Bar dataKey="minutes" fill="#F44336" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">{t('noTardiness')}</div>
              )
            })()}
          </CardContent>
        </Card>

        {/* Leave Usage Progress */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {lang === 'ar' ? 'استخدام الإجازات' : 'Leave Usage'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Overall progress */}
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">{t('used')} / {t('balance')}</span>
                  <span className="font-bold">{usedDays} / {employee.leave_balance}</span>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usedDays / employee.leave_balance > 0.8 ? 'bg-rose-500' :
                      usedDays / employee.leave_balance > 0.5 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, usedDays / employee.leave_balance * 100)}%` }}
                  />
                </div>
              </div>
              {/* By type breakdown */}
              <div className="space-y-3">
                {leaveBreakdown.map(lt => (
                  <div key={lt.id}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lt.color }} />
                        <span>{lang === 'ar' ? lt.name_ar : lt.name_en}</span>
                      </div>
                      <span className="font-semibold">{lt.days} {t('days')}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ backgroundColor: lt.color, width: `${Math.min(100, lt.days / Math.max(usedDays, 1) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              {/* Summary stats */}
              <div className="grid grid-cols-2 gap-3 pt-3 border-t">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">{t('remaining')}</p>
                  <p className={`text-lg font-bold ${remaining < 5 ? 'text-rose-500' : 'text-emerald-500'}`}>{remaining}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">{t('deduction')}</p>
                  <p className="text-lg font-bold">{deduction.toFixed(3)} {settings?.currency_symbol}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="leaves" dir={dir}>
        <TabsList>
          <TabsTrigger value="leaves">{t('leaveHistory')} ({approvedLeaves.length})</TabsTrigger>
          <TabsTrigger value="tardiness">{t('tardinessHistory')} ({tardiness.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="leaves">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t('leaveType')}</TableHead>
                    <TableHead className="text-center">{t('fromDate')}</TableHead>
                    <TableHead className="text-center">{t('toDate')}</TableHead>
                    <TableHead className="text-center">{t('daysCount')}</TableHead>
                    <TableHead className="text-start">{t('notes')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvedLeaves.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        {t('noLeaves')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    approvedLeaves.map((leave) => {
                      const lt = leaveTypes.find(t => t.id === leave.leave_type_id)
                      return (
                        <TableRow key={leave.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lt?.color }} />
                              {lang === 'ar' ? lt?.name_ar : lt?.name_en}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">{leave.start_date}</TableCell>
                          <TableCell className="text-center">{leave.end_date}</TableCell>
                          <TableCell className="text-center font-bold">{leave.days_count}</TableCell>
                          <TableCell>{leave.notes || '-'}</TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tardiness">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center">{t('date')}</TableHead>
                    <TableHead className="text-center">{t('time')}</TableHead>
                    <TableHead className="text-center">{t('lateMinutes')}</TableHead>
                    <TableHead className="text-start">{t('notes')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tardiness.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        {t('noTardiness')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    tardiness.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-center">{t.date}</TableCell>
                        <TableCell className="text-center">{t.time}</TableCell>
                        <TableCell className="text-center font-bold">{t.minutes_late}</TableCell>
                        <TableCell>{t.notes || '-'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
