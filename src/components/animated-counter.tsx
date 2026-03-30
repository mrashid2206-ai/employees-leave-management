'use client'

import { useEffect, useRef, useState } from 'react'

interface AnimatedCounterProps {
  value: number | string
  duration?: number
  className?: string
}

export function AnimatedCounter({ value, duration = 1000, className = '' }: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0)
  const prevValue = useRef(0)
  const isNumber = typeof value === 'number'

  useEffect(() => {
    if (!isNumber) return

    const start = prevValue.current
    const end = value as number
    const startTime = performance.now()

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = start + (end - start) * eased

      setDisplayValue(Math.round(current * 10) / 10)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        prevValue.current = end
      }
    }

    requestAnimationFrame(animate)
  }, [value, duration, isNumber])

  if (!isNumber) return <span className={className}>{value}</span>

  return <span className={className}>{displayValue}</span>
}
