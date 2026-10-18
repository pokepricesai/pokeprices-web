// PP-TCG-MIGRATE-03: full-template TCGGraph preview.
//
// This route renders the EXISTING CardPageClient (the production
// card page) with TCGGraph data substituted into the exact shape
// the component already expects. No parallel layout; one source of
// truth for the design.
//
// The companion diagnostic route at /admin/tcg-preview/[slug] stays
// available for raw-data inspection; this one is "what the public
// page would look like after cut-over".

import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { cookies } from 'next/headers'
import { getProviderSnapshot } from '@/lib/providerData/snapshot'
import { getProviderHistorySeries } from '@/lib/providerData/history'
import { adaptSnapshotToLegacyCardRow, adaptProviderHistoryForChart } from '@/lib/providerData/toCardRow'
import { loadLatestFxTable, parseDisplayCcy, DISPLAY_CCY_COOKIE } from '@/lib/providerData/currency'
import CardPageClient from '@/app/set/[slug]/card/[cardSlug]/CardPageClient'
import TcgGraphMarketPanel from '@/components/tcgPreview/TcgGraphMarketPanel'
import CurrencySelector from '@/components/currency/CurrencySelector'

export const metadata: Metadata = {
  title: 'TCGGraph full-template preview · PokePrices admin',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
}
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps { params: Promise<{ slug: string }> }

export default async function TcgPreviewFull({ params }: PageProps) {
  await requireAdminPage('/admin/tcg-preview')
  const { slug } = await params
  const decoded = decodeURIComponent(slug)

  const sb = getSupabaseServiceClient()
  // Display currency: cookie-driven; USD default. FX table pulled
  // from the pokemon_tcg_fx_rates snapshot.
  const cookieStore = await cookies()
  const displayCcy = parseDisplayCcy(cookieStore.get(DISPLAY_CCY_COOKIE)?.value)
  const fx = await loadLatestFxTable(sb)

  // Fetch everything in parallel.
  const [ppRes, snapshot] = await Promise.all([
    sb.from('cards')
      .select('card_slug, card_name, set_name, card_number, card_number_display, set_printed_total, language, card_url_slug, image_url, is_sealed')
      .eq('card_slug', decoded)
      .maybeSingle(),
    getProviderSnapshot(sb, decoded, { previewMode: true }),
  ])

  const pp = ppRes.data as {
    card_slug: string
    card_name: string
    set_name: string
    card_number: string | null
    card_number_display: string | null
    set_printed_total: number | null
    language: string | null
    card_url_slug: string | null
    image_url: string | null
    is_sealed: boolean | null
  } | null
  if (!pp) notFound()

  // Pull history now that we know the TCG card id
  let historySeries: Awaited<ReturnType<typeof getProviderHistorySeries>> = []
  if (snapshot?.tcg_card_id && snapshot?.tcg_printing_key) {
    historySeries = await getProviderHistorySeries(sb, snapshot.tcg_card_id, snapshot.tcg_printing_key, { ignoreFlag: true })
  }

  // Adapt → legacy shapes
  const legacyBase = {
    card_slug: pp.card_slug,
    card_url_slug: pp.card_url_slug,
    card_name: pp.card_name,
    set_name: pp.set_name,
    card_number: pp.card_number,
    card_number_display: pp.card_number_display,
    set_printed_total: pp.set_printed_total,
    image_url: pp.image_url,
    language: pp.language ?? 'en',
    is_sealed: pp.is_sealed,
  }
  const adapted = adaptSnapshotToLegacyCardRow(legacyBase, snapshot)
  const cardForClient = adapted?.card ?? legacyBase
  const chartData = adaptProviderHistoryForChart(historySeries)

  const quickFactsSlot = snapshot
    ? <TcgGraphMarketPanel snapshot={snapshot} displayCurrency={displayCcy} fx={fx} />
    : null

  // Public URL for comparison
  const publicUrl = pp.card_url_slug && pp.set_name
    ? `https://www.pokeprices.io/set/${encodeURIComponent(pp.set_name)}/card/${encodeURIComponent(pp.card_url_slug)}`
    : null

  // Thin admin banner at top so the operator always knows this is
  // the preview and not the real page.
  return (
    <>
      <div
        aria-label="TCGGraph preview banner"
        style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: '#1a1a1a', color: '#ffd34f',
          padding: '8px 14px', fontSize: 12, fontFamily: 'system-ui, sans-serif',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 10, flexWrap: 'wrap',
        }}
      >
        <div>
          <strong style={{ color: '#fff' }}>TCGGraph preview</strong>
          {' · '}
          <span>pricing_eligibility: <code>{snapshot?.pricing_eligibility ?? 'no snapshot'}</code></span>
          {' · '}
          <span>tcg_card_id: <code>{snapshot?.tcg_card_id ?? '—'}</code></span>
          {' · '}
          <span>printing: <code>{snapshot?.tcg_printing_key ?? '—'}</code></span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <CurrencySelector previewOnly />
          <Link href={`/admin/tcg-preview/${encodeURIComponent(decoded)}`} style={{ color: '#ffd34f' }}>Diagnostic view</Link>
          {publicUrl && (
            <a href={publicUrl} target="_blank" rel="noreferrer" style={{ color: '#ffd34f' }}>Current public page ↗</a>
          )}
          <Link href="/admin/tcg-preview" style={{ color: '#ffd34f' }}>Index</Link>
        </div>
      </div>

      {/*
        The ACTUAL production card page component. We hand it:
         - initialCardData: TCGGraph-adapted CardRow (raw/psa10 in
           cents, PSA 9 null, ACE 10 null, image provider URL)
         - initialTrendData: null (TCGGraph does not publish the
           7d/30d/90d/180d/365d/2y/5y % moves — the chart renders
           the ingested history series only; trend chips in the
           hero use null-safe formatting that renders em-dashes)
         - initialPriceHistory: provider history mapped to the
           chart's expected key set (raw_usd, psa10_usd, etc. — in
           cents, pooled grades deliberately NOT mapped).
         - quickFactsSlot: additional TCG marketplace + condition
           + per-grader-10 + pooled-grade panel below the hero.
      */}
      <CardPageClient
        setName={pp.set_name}
        cardUrlSlug={pp.card_url_slug ?? pp.card_slug}
        initialCardData={cardForClient}
        initialTrendData={null}
        initialPriceHistory={chartData as unknown as Array<Record<string, unknown>>}
        quickFactsSlot={quickFactsSlot}
        providerMode
        displayCcy={displayCcy}
        fx={fx}
      />
    </>
  )
}
