'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLanguage, useT } from '@/lib/language-context'
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Clock,
  ClipboardCheck,
  Calendar,
  Trophy,
  FileText,
  Settings,
  DollarSign,
  CalendarRange,
  ChevronRight,
  ChevronLeft,
  Menu,
  LogOut,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import type { TranslationKey } from '@/lib/translations'

const navItems: { href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard }[] = [
  { href: '/', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/employees', labelKey: 'employees', icon: Users },
  { href: '/leaves', labelKey: 'leaves', icon: CalendarDays },
  { href: '/tardiness', labelKey: 'tardiness', icon: Clock },
  { href: '/calendar', labelKey: 'calendar', icon: Calendar },
  { href: '/attendance', labelKey: 'attendance', icon: ClipboardCheck },
  { href: '/salary-report', labelKey: 'salaryReport', icon: DollarSign },
  { href: '/overtime-report', labelKey: 'overtimeReport', icon: Clock },
  { href: '/leave-planner', labelKey: 'leavePlanner', icon: CalendarRange },
  { href: '/ranking', labelKey: 'ranking', icon: Trophy },
  { href: '/reports', labelKey: 'reports', icon: FileText },
  { href: '/settings', labelKey: 'settings', icon: Settings },
]

function NavContent({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname()
  const t = useT()

  return (
    <nav className="flex flex-col gap-1 p-3">
      {navItems.map((item) => {
        const isActive = pathname === item.href ||
          (item.href !== '/' && pathname.startsWith(item.href))
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{t(item.labelKey)}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const router = useRouter()
  const { dir } = useLanguage()
  const t = useT()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const isRTL = dir === 'rtl'

  return (
    <>
      {/* Mobile sidebar */}
      <Sheet>
        <SheetTrigger render={<Button variant="ghost" size="icon" className={`fixed top-16 ${isRTL ? 'right-3' : 'left-3'} z-50 md:hidden`} />}>
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side={isRTL ? 'right' : 'left'} className="w-64 p-0">
          <div className="flex h-16 items-center justify-center border-b px-4">
            <h2 className="text-lg font-bold text-primary">{t('appShort')}</h2>
          </div>
          <NavContent onNavigate={() => {}} />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col bg-card transition-all duration-300 h-screen sticky top-0',
          isRTL ? 'border-l' : 'border-r',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <div className="flex h-16 items-center justify-between border-b px-4">
          {!collapsed && (
            <h2 className="text-lg font-bold text-primary truncate">{t('appShort')}</h2>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="shrink-0"
          >
            {isRTL
              ? (collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)
              : (collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />)
            }
          </Button>
        </div>
        <NavContent collapsed={collapsed} />
        <div className="mt-auto border-t p-3">
          <button
            onClick={handleLogout}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors w-full',
              'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            )}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{t('logout')}</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
