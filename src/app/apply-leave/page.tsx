'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ApplyLeaveRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/check-in')
  }, [router])

  return null
}
