'use client'

import { useSyncExternalStore } from 'react'

// One shared one-second ticker for the portal clock. The clock used to be computed once
// per render, so it froze at whatever time the tab last re-rendered and an employee
// checking the screen before tapping "check in" read a stale time.
//
// useSyncExternalStore rather than useState+setInterval: the server render has no "now"
// that matches the client's, so the server snapshot is null and the real time arrives
// right after hydration instead of causing a mismatch.

let nowMs = 0
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let aligner: ReturnType<typeof setTimeout> | null = null

function tick() {
  nowMs = Date.now()
  for (const l of listeners) l()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (listeners.size === 1) {
    nowMs = Date.now()
    // Line ticks up with the wall-clock second so the seconds digit never lags by ~1s.
    aligner = setTimeout(() => {
      tick()
      timer = setInterval(tick, 1000)
    }, 1000 - (Date.now() % 1000))
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      if (aligner) clearTimeout(aligner)
      if (timer) clearInterval(timer)
      aligner = timer = null
    }
  }
}

const getSnapshot = () => nowMs
const getServerSnapshot = () => 0

/** The current instant, re-rendering every second; null during the server render. */
export function useNow(): Date | null {
  const ms = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return ms ? new Date(ms) : null
}
