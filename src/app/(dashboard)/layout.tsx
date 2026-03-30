'use client'

import { Sidebar } from '@/components/sidebar'
import { ErrorBoundary } from '@/components/error-boundary'
import { NotificationBell } from '@/components/notifications'
import { LanguageToggle } from '@/components/language-toggle'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()

  // Auto-refresh data every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries()
    }, 300000)
    return () => clearInterval(interval)
  }, [queryClient])

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-sm border-b">
          <div className="container mx-auto px-6 py-3 flex items-center justify-end gap-2">
            <LanguageToggle />
            <NotificationBell />
          </div>
        </div>
        <div className="container mx-auto p-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </main>
    </div>
  )
}
