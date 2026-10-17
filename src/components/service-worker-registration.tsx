'use client'

import { useEffect } from 'react'

// Registers /sw.js as soon as an employee-facing page loads. The browser only offers to
// install the portal once a service worker controls it, so this cannot wait until the
// employee happens to open the Profile tab (where the push opt-in lives).
//
// updateViaCache 'none' makes the browser revalidate sw.js itself on every update check,
// so a deploy that changes the worker reaches phones without waiting out an HTTP cache.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // Not fatal: the portal works without it, it just isn't installable/offline-aware.
      })
  }, [])
  return null
}
