'use client'

import { useEffect, useState, useTransition } from 'react'

// PP-TCG-MIGRATE-05 §2: compact USD/EUR header control.
//
// Writes a long-lived cookie `pp_display_ccy` and refreshes the
// current route so the server render picks up the new preference.
// No TCGGraph calls are made on switch — the server reads the FX
// snapshot from Supabase.
//
// SEO-safe: the cookie is read server-side so the SAME canonical
// URL serves either currency. We do NOT create ?ccy=EUR variants
// of card URLs. The canonical stays USD; any EUR display is
// personalisation layered on top.

const COOKIE_NAME = 'pp_display_ccy'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365    // 1 year

function setCookie(value: 'USD' | 'EUR') {
  document.cookie = `${COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`
}
function readCookie(): 'USD' | 'EUR' {
  if (typeof document === 'undefined') return 'USD'
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`))
  const v = match ? decodeURIComponent(match[1] as string) : 'USD'
  return v === 'EUR' ? 'EUR' : 'USD'
}

interface Props {
  /** When true, the dropdown renders with "Preview only" styling and
   *  a disclosure note. Used on authenticated admin pages before the
   *  public rollout. Public mode shows just the compact selector. */
  previewOnly?: boolean
  /** Called after the cookie is written. Caller may trigger a soft
   *  re-render (`router.refresh()`) so the server reads the new ccy. */
  onChange?: (ccy: 'USD' | 'EUR') => void
}

export default function CurrencySelector({ previewOnly, onChange }: Props) {
  const [ccy, setCcy] = useState<'USD' | 'EUR'>('USD')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setCcy(readCookie())
  }, [])

  const change = (next: 'USD' | 'EUR') => {
    if (next === ccy) return
    setCookie(next)
    setCcy(next)
    startTransition(() => {
      onChange?.(next)
    })
  }

  return (
    <div
      aria-label="display currency"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: "'Figtree', sans-serif", fontSize: 12,
      }}
    >
      {previewOnly && (
        <span style={{
          padding: '2px 6px', background: '#fff5d2', border: '1px solid #e5c454',
          borderRadius: 3, fontSize: 10, color: '#5a4300', marginRight: 4,
        }}>preview</span>
      )}
      <button
        type="button"
        onClick={() => change('USD')}
        className={ccy === 'USD' ? 'ccy-active' : ''}
        disabled={isPending}
        style={{
          padding: '3px 8px', fontSize: 12,
          background: ccy === 'USD' ? '#1a1a1a' : 'transparent',
          color: ccy === 'USD' ? '#fff' : '#555',
          border: '1px solid #d0d0d0', borderRadius: 3,
          cursor: ccy === 'USD' ? 'default' : 'pointer',
        }}
      >$ USD</button>
      <button
        type="button"
        onClick={() => change('EUR')}
        className={ccy === 'EUR' ? 'ccy-active' : ''}
        disabled={isPending}
        style={{
          padding: '3px 8px', fontSize: 12,
          background: ccy === 'EUR' ? '#1a1a1a' : 'transparent',
          color: ccy === 'EUR' ? '#fff' : '#555',
          border: '1px solid #d0d0d0', borderRadius: 3,
          cursor: ccy === 'EUR' ? 'default' : 'pointer',
        }}
      >€ EUR</button>
    </div>
  )
}
