// PP-TCG-MIGRATE-02: private TCGGraph preview index.
//
// Admin-only route (requireAdminPage). Lists representative sample
// cards across the cohorts the brief asks for, with a direct link
// into each per-card preview. Noindex at every level.

import Link from 'next/link'
import type { Metadata } from 'next'
import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const metadata: Metadata = {
  title: 'TCGGraph preview · PokePrices admin',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
}
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Sample {
  slug: string
  label: string
  cohort: string
  pricing_eligibility: string | null
}

const CURATED: Array<{ label: string; cohort: string; filter: (q: any) => any }> = [
  { label: 'Normal modern English (bulk_safe)',
    cohort: 'en-modern',
    filter: (q) => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en')
      .ilike('pp_set_name', '%Scarlet%') },
  { label: 'Vintage English (bulk_safe)',
    cohort: 'vintage',
    filter: (q) => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en')
      .in('pp_set_name', ['Base Set','Jungle','Fossil','Base Set 2','Team Rocket','Neo Genesis']) },
  { label: '1st Edition (market_only — variant)',
    cohort: 'variant-1st-ed',
    filter: (q) => q.eq('pricing_eligibility', 'market_only').ilike('pp_card_name', '%[1st Edition]%') },
  { label: 'Shadowless (market_only — variant)',
    cohort: 'variant-shadowless',
    filter: (q) => q.eq('pricing_eligibility', 'market_only').ilike('pp_card_name', '%[Shadowless]%') },
  { label: 'Reverse Holo (market_only — variant)',
    cohort: 'variant-reverse-holo',
    filter: (q) => q.eq('pricing_eligibility', 'market_only').ilike('pp_card_name', '%[Reverse Holo]%') },
  { label: 'Japanese (bulk_safe, no graded)',
    cohort: 'ja',
    filter: (q) => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'jp') },
  { label: 'Promo (identity verified)',
    cohort: 'promo',
    filter: (q) => q.ilike('pp_set_name', '%Promo%').eq('confidence', 'verified') },
  { label: 'Restricted pricing — unmapped variant tag (identity_only)',
    cohort: 'unsupported-variant',
    filter: (q) => q.eq('pricing_eligibility', 'identity_only').ilike('pp_card_name', '%[Mirror Holo]%') },
  { label: 'No TCG equivalent (Topps/BK)',
    cohort: 'no-equivalent',
    filter: (q) => q.eq('review_status', 'no_tcg_equivalent') },
  { label: 'High-traffic card (GSC rank)',
    cohort: 'high-traffic',
    filter: (q) => q.not('commercial_rank', 'is', null).order('commercial_rank', { ascending: true }) },
]

async function fetchSamples(sb: any): Promise<Sample[]> {
  const out: Sample[] = []
  for (const row of CURATED) {
    let q = sb.from('pokemon_tcg_mappings')
      .select('pp_card_slug, pp_card_name, pp_set_name, pp_language, pricing_eligibility')
      .eq('provider', 'tcggraph')
      .limit(1)
    q = row.filter(q)
    const { data, error } = await q
    if (error || !data || data.length === 0) continue
    const r = data[0]
    out.push({
      slug: r.pp_card_slug,
      label: `${row.label} — ${r.pp_card_name ?? r.pp_card_slug} (${r.pp_set_name ?? '?'}, ${r.pp_language})`,
      cohort: row.cohort,
      pricing_eligibility: r.pricing_eligibility ?? null,
    })
  }
  return out
}

export default async function TcgPreviewIndex() {
  await requireAdminPage('/admin/tcg-preview')
  const sb = getSupabaseServiceClient()
  const samples = await fetchSamples(sb)

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>TCGGraph preview · PokePrices admin</h1>
      <p style={{ fontSize: 13, color: '#555', margin: '8px 0 16px' }}>
        These preview pages render the <strong>new TCGGraph data</strong> that will replace the current
        PriceCharting-derived pipeline after cut-over. Public PokePrices pages are unchanged. Every public
        activation flag is OFF. See{' '}
        <a href="https://github.com/pokepricesai/collector-network/blob/main/docs/pp-tcg-migrate-01/CUTOVER.md"
           target="_blank" rel="noreferrer">docs/pp-tcg-migrate-01/CUTOVER.md</a> for the staged activation plan.
      </p>

      <div style={{ display: 'grid', gap: 10 }}>
        {samples.map(s => (
          <div key={s.slug} style={{ padding: 12, border: '1px solid #e0e0e0', borderRadius: 4, background: '#fafafa' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{s.cohort} · pricing_eligibility=<code>{s.pricing_eligibility ?? '—'}</code></div>
            <Link
              href={`/admin/tcg-preview/${encodeURIComponent(s.slug)}`}
              style={{ fontSize: 14, fontWeight: 600, color: '#2a56c8', textDecoration: 'none' }}
            >
              {s.label}
            </Link>
          </div>
        ))}
      </div>

      {samples.length === 0 && (
        <div style={{ padding: 16, border: '1px solid #e5c0c0', background: '#fdf1f1', borderRadius: 4, fontSize: 13 }}>
          No sample cards matched the curated filters. The provider tables may be empty — run{' '}
          <code>node scripts/pp-tcg-migrate-01-ingest.mjs</code> to populate them.
        </div>
      )}
    </main>
  )
}
