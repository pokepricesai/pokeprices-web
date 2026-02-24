import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://egidpsrkqvymvioidatc.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const CHAT_ENDPOINT = `${supabaseUrl}/functions/v1/smart-endpoint`

export function formatPrice(cents: number | null | undefined): string {
  if (!cents || cents === 0) return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPriceGBP(cents: number | null | undefined): string {
  if (!cents || cents === 0) return '—'
  const gbp = cents / 100 / 1.27
  return '£' + gbp.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPriceShort(cents: number | null | undefined): string {
  if (!cents || cents === 0) return '—'
  const dollars = cents / 100
  if (dollars >= 1000) return '$' + (dollars / 1000).toFixed(1) + 'k'
  return '$' + dollars.toFixed(2)
}

export function formatPct(pct: number | null | undefined): { text: string; color: string } {
  if (pct === null || pct === undefined) return { text: '—', color: 'var(--text-muted)' }
  const sign = pct >= 0 ? '+' : ''
  return {
    text: `${sign}${pct.toFixed(1)}%`,
    color: pct > 0 ? 'var(--green)' : pct < 0 ? 'var(--red)' : 'var(--text-muted)',
  }
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatChartPrice(cents: number): string {
  if (!cents) return '$0'
  const d = cents / 100
  if (d >= 1000) return '$' + (d / 1000).toFixed(1) + 'k'
  if (d >= 100) return '$' + d.toFixed(0)
  return '$' + d.toFixed(2)
}
