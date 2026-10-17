'use client'

import { CalendarDays, ClipboardList, Clock, User } from 'lucide-react'
import { useT } from '@/lib/language-context'

export type PortalTab = 'attendance' | 'leave' | 'requests' | 'profile'

interface PortalNavProps {
  activeTab: PortalTab
  onChange: (tab: PortalTab) => void
}

/** Fixed bottom tab bar for the employee portal. */
export function PortalNav({ activeTab, onChange }: PortalNavProps) {
  const t = useT()

  const tabs: { id: PortalTab; icon: typeof Clock; label: string }[] = [
    { id: 'attendance', icon: Clock, label: t('checkInBtn') },
    { id: 'leave', icon: CalendarDays, label: t('applyLeave') },
    { id: 'requests', icon: ClipboardList, label: t('myRequests') },
    { id: 'profile', icon: User, label: t('myInfo') },
  ]

  return (
    <nav
      aria-label={t('portalSections')}
      className="fixed bottom-0 inset-x-0 bg-card/80 backdrop-blur-md border-t z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]"
    >
      <div className="max-w-lg mx-auto flex overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            // The visible label is the button's name; aria-current tells a screen reader
            // which section is showing, which the colour change alone does not.
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
              onClick={() => onChange(tab.id)}
            >
              <Icon aria-hidden="true" className={`h-5 w-5 ${isActive ? 'text-primary' : ''}`} />
              <span className="text-xs font-medium">{tab.label}</span>
              {isActive && <div aria-hidden="true" className="w-6 h-0.5 rounded-full bg-primary" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
