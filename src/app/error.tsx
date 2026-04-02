'use client'

import { Button } from '@/components/ui/button'

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-rose-500">Error</h1>
        <p className="text-muted-foreground">Something went wrong</p>
        <Button onClick={reset}>Try Again</Button>
      </div>
    </div>
  )
}
