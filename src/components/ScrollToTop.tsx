'use client'
// Force scroll-to-top on route change. Next.js App Router usually does
// this automatically but misses some cases (param-only changes, certain
// transitions) — this just makes the behaviour deterministic.
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export default function ScrollToTop() {
  const pathname = usePathname()
  useEffect(() => {
    // 'instant' avoids the visual scroll-up animation on every nav.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}
