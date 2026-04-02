'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
        <p className="text-lg text-muted-foreground">Page not found</p>
        <div className="flex gap-3 justify-center">
          <Link href="/"><Button>Dashboard</Button></Link>
          <Link href="/employee-login"><Button variant="outline">Employee Portal</Button></Link>
        </div>
      </div>
    </div>
  )
}
