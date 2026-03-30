'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Save, Plus, Pencil, Trash2, Calendar, Clock, Building2, Palette,
  CalendarDays, DollarSign, Users, Zap, RotateCcw, Play
} from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useT } from '@/lib/language-context'
import { getSettings, updateSettings, getDepartments, createDepartment, updateDepartment, deleteDepartment, getHolidays, createHoliday, updateHoliday, deleteHoliday, getEmployees, getLeaveTypes, createLeaveType, updateLeaveType, deleteLeaveType } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import type { Settings } from '@/lib/types'

export default function SettingsPage() {
  const t = useT()
  const { dir, lang } = useLanguage()
  const queryClient = useQueryClient()

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const { data: holidays = [] } = useQuery({ queryKey: ['holidays'], queryFn: getHolidays })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leaveTypes'], queryFn: getLeaveTypes })
  const { data: allLeaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: () => fetch('/api/leaves').then(r => r.json()) })

  const [form, setForm] = useState<Partial<Settings>>({})
  const [deptName, setDeptName] = useState('')
  const [editDept, setEditDept] = useState<{ id: number; name: string } | null>(null)
  const [holidayForm, setHolidayForm] = useState({ name: '', date: '' })
  const [editHoliday, setEditHoliday] = useState<{ id: number; name: string; date: string } | null>(null)
  const [holidayYear, setHolidayYear] = useState(String(new Date().getFullYear()))
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; type: string; id: number; name: string }>({ open: false, type: '', id: 0, name: '' })
  const [ltForm, setLtForm] = useState({ name_ar: '', name_en: '', color: '#4CAF50' })
  const [editLt, setEditLt] = useState<{ id: number; name_ar: string; name_en: string; color: string } | null>(null)
  const [processDate, setProcessDate] = useState(new Date().toISOString().split('T')[0])
  const [processResult, setProcessResult] = useState<any>(null)
  const [processing, setProcessing] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [activeSection, setActiveSection] = useState('general')

  useEffect(() => { if (settings) setForm(settings) }, [settings])

  // Mutations
  const settingsMutation = useMutation({ mutationFn: (data: Partial<Settings>) => updateSettings(data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success(t('savedSuccess')) }, onError: () => toast.error(t('error')) })
  const createDeptMutation = useMutation({ mutationFn: createDepartment, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['departments'] }); setDeptName(''); toast.success(t('addedSuccess')) } })
  const updateDeptMutation = useMutation({ mutationFn: ({ id, name }: { id: number; name: string }) => updateDepartment(id, name), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['departments'] }); setEditDept(null); toast.success(t('updatedSuccess')) } })
  const deleteDeptMutation = useMutation({ mutationFn: deleteDepartment, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['departments'] }); toast.success(t('deletedSuccess')) }, onError: (err: Error) => toast.error(err.message) })
  const createHolidayMutation = useMutation({ mutationFn: createHoliday, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['holidays'] }); setHolidayForm({ name: '', date: '' }); toast.success(t('addedSuccess')) } })
  const updateHolidayMutation = useMutation({ mutationFn: ({ id, data }: { id: number; data: { name: string; date: string } }) => updateHoliday(id, data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['holidays'] }); setEditHoliday(null); toast.success(t('updatedSuccess')) } })
  const deleteHolidayMutation = useMutation({ mutationFn: deleteHoliday, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['holidays'] }); toast.success(t('deletedSuccess')) } })
  const createLtMutation = useMutation({ mutationFn: createLeaveType, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaveTypes'] }); setLtForm({ name_ar: '', name_en: '', color: '#4CAF50' }); toast.success(t('addedSuccess')) } })
  const updateLtMutation = useMutation({ mutationFn: ({ id, data }: { id: number; data: any }) => updateLeaveType(id, data), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaveTypes'] }); setEditLt(null); toast.success(t('updatedSuccess')) } })
  const deleteLtMutation = useMutation({ mutationFn: deleteLeaveType, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaveTypes'] }); toast.success(t('deletedSuccess')) }, onError: (err: Error) => toast.error(err.message) })

  async function runDailyProcess() {
    setProcessing(true)
    try {
      const res = await fetch('/api/automation/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: processDate }) })
      setProcessResult(await res.json()); queryClient.invalidateQueries(); toast.success(t('addedSuccess'))
    } catch { toast.error(t('error')) }
    setProcessing(false)
  }

  async function runYearlyReset() {
    setProcessing(true)
    try {
      const res = await fetch('/api/automation/yearly-reset', { method: 'POST' })
      setProcessResult(await res.json()); queryClient.invalidateQueries(); toast.success(t('savedSuccess')); setResetConfirm(false)
    } catch { toast.error(t('error')) }
    setProcessing(false)
  }

  function handleDeleteConfirm() {
    if (deleteConfirm.type === 'dept') deleteDeptMutation.mutate(deleteConfirm.id)
    else if (deleteConfirm.type === 'leaveType') deleteLtMutation.mutate(deleteConfirm.id)
    else if (deleteConfirm.type === 'holiday') deleteHolidayMutation.mutate(deleteConfirm.id)
  }

  function formatHolidayDate(dateStr: string) {
    try {
      return new Date(dateStr + 'T00:00:00').toLocaleDateString(lang === 'ar' ? 'ar-OM' : 'en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
      })
    } catch { return dateStr }
  }

  function daysUntilHoliday(dateStr: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const holiday = new Date(dateStr + 'T00:00:00')
    const diff = Math.ceil((holiday.getTime() - today.getTime()) / 86400000)
    return diff
  }

  if (!settings) return <div className="p-6">{t('loading')}</div>

  const sections = [
    { id: 'general', icon: Building2, label: t('generalSettings') },
    { id: 'schedule', icon: Clock, label: lang === 'ar' ? 'جدول العمل' : 'Work Schedule' },
    { id: 'departments', icon: Users, label: t('departments') },
    { id: 'leaveTypes', icon: Palette, label: t('leaveTypes') },
    { id: 'holidays', icon: Calendar, label: t('holidays') },
    { id: 'automation', icon: Zap, label: t('automation') },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('settings')}</h1>

      <div className="flex gap-6 flex-col lg:flex-row">
        {/* Sidebar Navigation */}
        <div className="lg:w-56 shrink-0">
          <Card className="border-0 shadow-lg sticky top-20">
            <CardContent className="p-2">
              {sections.map(s => {
                const Icon = s.icon
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      activeSection === s.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{s.label}</span>
                  </button>
                )
              })}
            </CardContent>
          </Card>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0">

          {/* General Settings */}
          {activeSection === 'general' && (
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-[#1976D2]" />
                  {t('systemSettings')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Fiscal Year */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    {t('fiscalYear')}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-accent/20">
                    <div>
                      <Label className="text-xs">{t('yearStart')}</Label>
                      <Input type="date" value={form.year_start || ''} onChange={e => setForm(f => ({ ...f, year_start: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">{t('yearEnd')}</Label>
                      <Input type="date" value={form.year_end || ''} onChange={e => setForm(f => ({ ...f, year_end: e.target.value }))} />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Leave & Deduction */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    {lang === 'ar' ? 'الإجازات والخصومات' : 'Leave & Deductions'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-accent/20">
                    <div>
                      <Label className="text-xs">{t('annualBalance')}</Label>
                      <Input type="number" value={form.annual_leave_balance || ''} onChange={e => setForm(f => ({ ...f, annual_leave_balance: parseInt(e.target.value) }))} />
                    </div>
                    <div>
                      <Label className="text-xs">{t('deductionPerHour')}</Label>
                      <Input type="number" step="0.001" value={form.deduction_per_hour || ''} onChange={e => setForm(f => ({ ...f, deduction_per_hour: parseFloat(e.target.value) }))} />
                    </div>
                    <div>
                      <Label className="text-xs">{t('maxAbsent')}</Label>
                      <Input type="number" value={form.max_absent_same_dept || ''} onChange={e => setForm(f => ({ ...f, max_absent_same_dept: parseInt(e.target.value) }))} />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Currency */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    {t('currency')}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-accent/20">
                    <div>
                      <Label className="text-xs">{t('currency')}</Label>
                      <Input value={form.currency || ''} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">{t('currencySymbol')}</Label>
                      <Input value={form.currency_symbol || ''} onChange={e => setForm(f => ({ ...f, currency_symbol: e.target.value }))} />
                    </div>
                  </div>
                </div>

                <Button onClick={() => settingsMutation.mutate(form)} disabled={settingsMutation.isPending} className="w-full sm:w-auto">
                  <Save className="h-4 w-4 ml-2" />
                  {settingsMutation.isPending ? '...' : t('saveSettings')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Work Schedule */}
          {activeSection === 'schedule' && (
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-[#1976D2]" />
                  {lang === 'ar' ? 'جدول العمل' : 'Work Schedule'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-accent/20">
                  <div>
                    <Label className="text-xs">{t('workStartTime')}</Label>
                    <Input type="time" value={form.work_start_time || '08:00'} onChange={e => setForm(f => ({ ...f, work_start_time: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">{t('workHoursPerDay')}</Label>
                    <Input type="number" value={form.work_hours_per_day || ''} onChange={e => setForm(f => ({ ...f, work_hours_per_day: parseInt(e.target.value) }))} />
                  </div>
                </div>

                <div>
                  <Label className="text-xs mb-3 block">{t('workDays')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { day: 0, key: 'sunday' as const },
                      { day: 1, key: 'monday' as const },
                      { day: 2, key: 'tuesday' as const },
                      { day: 3, key: 'wednesday' as const },
                      { day: 4, key: 'thursday' as const },
                      { day: 5, key: 'friday' as const },
                      { day: 6, key: 'saturday' as const },
                    ].map(({ day, key }) => {
                      const workDays = (form.work_days || '0,1,2,3,4').split(',').map(Number)
                      const isActive = workDays.includes(day)
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                            isActive
                              ? 'bg-[#1976D2] text-white shadow-md'
                              : 'bg-muted text-muted-foreground hover:bg-accent'
                          }`}
                          onClick={() => {
                            const current = (form.work_days || '0,1,2,3,4').split(',').map(Number)
                            const updated = isActive ? current.filter(d => d !== day) : [...current, day].sort()
                            setForm(f => ({ ...f, work_days: updated.join(',') }))
                          }}
                        >
                          {t(key)}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-500/10 text-sm text-blue-400">
                  💡 {t('scheduleNote')}
                </div>

                <Button onClick={() => settingsMutation.mutate(form)} disabled={settingsMutation.isPending}>
                  <Save className="h-4 w-4 ml-2" />
                  {settingsMutation.isPending ? '...' : t('saveSettings')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Departments */}
          {activeSection === 'departments' && (
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-[#1976D2]" />
                    {t('deptManagement')}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Input placeholder={t('newDeptName')} value={deptName} onChange={e => setDeptName(e.target.value)} className="w-48" />
                    <Button size="sm" onClick={() => deptName && createDeptMutation.mutate(deptName)} disabled={!deptName}>
                      <Plus className="h-4 w-4 ml-1" />{t('add')}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {departments.map(dept => {
                    const empCount = employees.filter(e => e.department_id === dept.id && e.is_active).length
                    return (
                      <div key={dept.id} className="flex items-center justify-between p-4 rounded-xl bg-accent/20 hover:bg-accent/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#1976D2]/10 flex items-center justify-center">
                            <Building2 className="h-5 w-5 text-[#1976D2]" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{dept.name}</p>
                            <p className="text-xs text-muted-foreground">{empCount} {lang === 'ar' ? 'موظف' : 'employees'}</p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#1976D2]" onClick={() => setEditDept({ id: dept.id, name: dept.name })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => setDeleteConfirm({ open: true, type: 'dept', id: dept.id, name: dept.name })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Leave Types */}
          {activeSection === 'leaveTypes' && (
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5 text-[#1976D2]" />
                    {t('leaveTypeManagement')}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Add form */}
                <div className="flex gap-2 flex-wrap p-4 rounded-xl bg-accent/20">
                  <Input placeholder={t('nameAr')} value={ltForm.name_ar} onChange={e => setLtForm(f => ({ ...f, name_ar: e.target.value }))} className="w-36" />
                  <Input placeholder={t('nameEn')} value={ltForm.name_en} onChange={e => setLtForm(f => ({ ...f, name_en: e.target.value }))} className="w-36" />
                  <Input type="color" value={ltForm.color} onChange={e => setLtForm(f => ({ ...f, color: e.target.value }))} className="w-12 p-1 h-9 rounded-lg" />
                  <Button size="sm" onClick={() => ltForm.name_ar && ltForm.name_en && createLtMutation.mutate(ltForm)} disabled={!ltForm.name_ar || !ltForm.name_en}>
                    <Plus className="h-4 w-4 ml-1" />{t('add')}
                  </Button>
                </div>

                {/* Leave types grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {leaveTypes.map(lt => {
                    const usageCount = allLeaves.filter((l: any) => l.leave_type_id === lt.id).length
                    return (
                      <div key={lt.id} className="flex items-center justify-between p-4 rounded-xl bg-accent/20 hover:bg-accent/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: lt.color + '20' }}>
                            <div className="w-5 h-5 rounded-full" style={{ backgroundColor: lt.color }} />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{lt.name_ar}</p>
                            <p className="text-xs text-muted-foreground">{lt.name_en} · {usageCount} {lang === 'ar' ? 'استخدام' : 'uses'}</p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#1976D2]" onClick={() => setEditLt({ id: lt.id, name_ar: lt.name_ar, name_en: lt.name_en, color: lt.color })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => setDeleteConfirm({ open: true, type: 'leaveType', id: lt.id, name: lang === 'ar' ? lt.name_ar : lt.name_en })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Holidays */}
          {activeSection === 'holidays' && (() => {
            const years = [...new Set(holidays.map(h => h.date.slice(0, 4)))].sort()
            if (years.length > 0 && !years.includes(holidayYear)) setHolidayYear(years[0])
            const filteredHolidays = holidays.filter(h => h.date.startsWith(holidayYear))

            return (
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-[#1976D2]" />
                      {t('holidays')}
                    </CardTitle>
                    <div className="flex gap-2">
                      {years.map(y => (
                        <Button
                          key={y}
                          size="sm"
                          variant={holidayYear === y ? 'default' : 'outline'}
                          onClick={() => setHolidayYear(y)}
                          className="text-xs"
                        >
                          {y}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Add form */}
                  <div className="flex gap-2 flex-wrap p-4 rounded-xl bg-accent/20">
                    <Input placeholder={t('holidayName')} value={holidayForm.name} onChange={e => setHolidayForm(f => ({ ...f, name: e.target.value }))} className="flex-1 min-w-[150px]" />
                    <Input type="date" value={holidayForm.date} onChange={e => setHolidayForm(f => ({ ...f, date: e.target.value }))} className="w-44" />
                    <Button size="sm" onClick={() => holidayForm.name && holidayForm.date && createHolidayMutation.mutate(holidayForm)} disabled={!holidayForm.name || !holidayForm.date}>
                      <Plus className="h-4 w-4 ml-1" />{t('add')}
                    </Button>
                  </div>

                  {/* Summary */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>{filteredHolidays.length} {lang === 'ar' ? 'عطلة في' : 'holidays in'} {holidayYear}</span>
                  </div>

                  {/* Holidays list */}
                  <div className="space-y-2">
                    {filteredHolidays.map(h => {
                      const daysLeft = daysUntilHoliday(h.date)
                      const isPast = daysLeft < 0
                      const isToday = daysLeft === 0
                      const isSoon = daysLeft > 0 && daysLeft <= 7
                      return (
                        <div key={h.id} className={`flex items-center justify-between p-4 rounded-xl transition-colors ${
                          isPast ? 'bg-muted/30 opacity-60' : isToday ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30' : 'bg-accent/20 hover:bg-accent/30'
                        }`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                              isPast ? 'bg-muted' : isToday ? 'bg-emerald-500/20' : isSoon ? 'bg-amber-500/20' : 'bg-[#1976D2]/10'
                            }`}>
                              <Calendar className={`h-5 w-5 ${
                                isPast ? 'text-muted-foreground' : isToday ? 'text-emerald-500' : isSoon ? 'text-amber-500' : 'text-[#1976D2]'
                              }`} />
                            </div>
                            <div>
                              <p className="font-semibold text-sm">{h.name}</p>
                              <p className="text-xs text-muted-foreground">{formatHolidayDate(h.date)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isToday ? (
                              <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[10px]">
                                {lang === 'ar' ? 'اليوم' : 'Today'}
                              </Badge>
                            ) : isPast ? (
                              <Badge variant="outline" className="text-[10px] opacity-60">
                                {lang === 'ar' ? 'انتهت' : 'Past'}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className={`text-[10px] ${isSoon ? 'border-amber-500/30 text-amber-500' : ''}`}>
                                {daysLeft} {lang === 'ar' ? 'يوم' : 'days'}
                              </Badge>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-[#1976D2]" onClick={() => setEditHoliday({ id: h.id, name: h.name, date: h.date })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => setDeleteConfirm({ open: true, type: 'holiday', id: h.id, name: h.name })}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                    {filteredHolidays.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground text-sm">{t('noData')}</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })()}

          {/* Automation */}
          {activeSection === 'automation' && (
            <div className="space-y-6">
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Play className="h-5 w-5 text-[#1976D2]" />
                    {t('runDailyProcess')}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {lang === 'ar'
                      ? 'تسجيل الغياب التلقائي وإنشاء سجلات التأخير من أوقات الحضور المتأخرة'
                      : 'Auto-mark absent and create tardiness records from late check-ins'}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <Label className="text-xs">{t('processDate')}</Label>
                      <Input type="date" value={processDate} onChange={e => setProcessDate(e.target.value)} className="w-48" />
                    </div>
                    <Button onClick={runDailyProcess} disabled={processing}>
                      <Play className="h-4 w-4 ml-2" />
                      {processing ? '...' : t('runProcess')}
                    </Button>
                  </div>
                  {processResult && processResult.absentMarked !== undefined && (
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl bg-rose-500/10 text-center">
                        <p className="text-xs text-muted-foreground">{t('absentMarked')}</p>
                        <p className="text-xl font-bold text-rose-500">{processResult.absentMarked}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-amber-500/10 text-center">
                        <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'إجازة مخصومة' : 'Leave deducted'}</p>
                        <p className="text-xl font-bold text-amber-500">{processResult.leaveDeducted || 0}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-blue-500/10 text-center">
                        <p className="text-xs text-muted-foreground">{t('tardinessCreated')}</p>
                        <p className="text-xl font-bold text-blue-500">{processResult.tardinessCreated}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-0 shadow-lg ring-1 ring-amber-500/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-amber-500">
                    <RotateCcw className="h-5 w-5" />
                    {t('yearlyReset')}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {lang === 'ar'
                      ? 'إعادة تعيين رصيد الإجازات لجميع الموظفين وتقديم السنة المالية'
                      : 'Reset all leave balances and advance the fiscal year'}
                  </p>
                </CardHeader>
                <CardContent>
                  {!resetConfirm ? (
                    <Button variant="outline" className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10" onClick={() => setResetConfirm(true)}>
                      <RotateCcw className="h-4 w-4 ml-2" />
                      {t('resetBalance')}
                    </Button>
                  ) : (
                    <div className="p-4 rounded-xl bg-amber-500/10 space-y-3">
                      <p className="text-sm">{t('confirmReset')}</p>
                      <div className="flex gap-2">
                        <Button variant="destructive" onClick={runYearlyReset} disabled={processing}>
                          {processing ? '...' : t('confirmDelete')}
                        </Button>
                        <Button variant="outline" onClick={() => setResetConfirm(false)}>{t('cancel')}</Button>
                      </div>
                    </div>
                  )}
                  {processResult && processResult.employeesReset !== undefined && (
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl bg-accent/30 text-center">
                        <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'تم التعيين' : 'Reset'}</p>
                        <p className="text-xl font-bold">{processResult.employeesReset}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-accent/30 text-center">
                        <p className="text-xs text-muted-foreground">{lang === 'ar' ? 'الرصيد' : 'Balance'}</p>
                        <p className="text-xl font-bold">{processResult.newBalance}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-accent/30 text-center">
                        <p className="text-xs text-muted-foreground">{t('fiscalYear')}</p>
                        <p className="text-sm font-bold">{processResult.newYearStart?.slice(0,4)}-{processResult.newYearEnd?.slice(0,4)}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Edit Department Dialog */}
      {editDept && (
        <Dialog open={!!editDept} onOpenChange={() => setEditDept(null)}>
          <DialogContent className="max-w-sm" dir={dir}>
            <DialogHeader><DialogTitle>{t('editDept')}</DialogTitle></DialogHeader>
            <div>
              <Label>{t('deptName')}</Label>
              <Input value={editDept.name} onChange={e => setEditDept(d => d ? { ...d, name: e.target.value } : null)} />
            </div>
            <DialogFooter>
              <Button onClick={() => editDept && updateDeptMutation.mutate(editDept)} disabled={updateDeptMutation.isPending}>{t('save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Leave Type Dialog */}
      {editLt && (
        <Dialog open={!!editLt} onOpenChange={() => setEditLt(null)}>
          <DialogContent className="max-w-sm" dir={dir}>
            <DialogHeader><DialogTitle>{t('editLeaveType')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>{t('nameAr')}</Label><Input value={editLt.name_ar} onChange={e => setEditLt(d => d ? { ...d, name_ar: e.target.value } : null)} /></div>
              <div><Label>{t('nameEn')}</Label><Input value={editLt.name_en} onChange={e => setEditLt(d => d ? { ...d, name_en: e.target.value } : null)} /></div>
              <div><Label>{t('color')}</Label><Input type="color" value={editLt.color} onChange={e => setEditLt(d => d ? { ...d, color: e.target.value } : null)} className="w-20 p-1 h-9" /></div>
            </div>
            <DialogFooter>
              <Button onClick={() => editLt && updateLtMutation.mutate({ id: editLt.id, data: { name_ar: editLt.name_ar, name_en: editLt.name_en, color: editLt.color } })} disabled={updateLtMutation.isPending}>{t('save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Holiday Dialog */}
      {editHoliday && (
        <Dialog open={!!editHoliday} onOpenChange={() => setEditHoliday(null)}>
          <DialogContent className="max-w-sm" dir={dir}>
            <DialogHeader><DialogTitle>{lang === 'ar' ? 'تعديل العطلة' : 'Edit Holiday'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>{t('holidayName')}</Label><Input value={editHoliday.name} onChange={e => setEditHoliday(d => d ? { ...d, name: e.target.value } : null)} /></div>
              <div><Label>{t('date')}</Label><Input type="date" value={editHoliday.date} onChange={e => setEditHoliday(d => d ? { ...d, date: e.target.value } : null)} /></div>
            </div>
            <DialogFooter>
              <Button onClick={() => editHoliday && updateHolidayMutation.mutate({ id: editHoliday.id, data: { name: editHoliday.name, date: editHoliday.date } })} disabled={updateHolidayMutation.isPending}>{t('save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(c => ({ ...c, open }))}
        title={deleteConfirm.type === 'dept' ? t('deleteDept') : deleteConfirm.type === 'leaveType' ? t('deleteLeaveType') : t('deleteHoliday')}
        description={`${t('areYouSure')} "${deleteConfirm.name}"?`}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
