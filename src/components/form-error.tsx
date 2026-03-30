'use client'

import { AlertTriangle } from 'lucide-react'

export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div className="flex items-center gap-2 text-sm text-rose-500 bg-rose-500/10 p-2.5 rounded-lg">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
