import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://egidpsrkqvymvioidatc.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_Rrqr1URHIyv787uq5ats7w_4DDLy0Ql'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const CHAT_ENDPOINT = `${supabaseUrl}/functions/v1/smart-endpoint`

export function formatPrice(cents: number | null): string {
  if (!cents || cents === 0) return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPriceGBP(cents: number | null): string {
  if (!cents || cents === 0) return '—'
  const gbp = cents / 100 / 1.27
  return '£' + gbp.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPct(pct: number | null): { text: string; color: string } {
  if (pct === null || pct === undefined) return { text: '—', color: 'text-gray-400' }
  const sign = pct >= 0 ? '+' : ''
  return {
    text: `${sign}${pct.toFixed(1)}%`,
    color: pct > 0 ? 'price-up' : pct < 0 ? 'price-down' : 'text-gray-500',
  }
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
