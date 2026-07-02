// app/sitemap-cards-1.xml/route.ts
// Block 5A-W-35 — filters to cards with a market signal on any grade
// tier. Fail-open: a daily_prices lookup error falls back to the
// pre-W35 unfiltered emission so a transient DB blip never empties
// the sitemap.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchIndexableCardBatch, renderCardSitemapXml } from '@/lib/seo-indexability/sitemapCards'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const result = await fetchIndexableCardBatch(supabase, 0, 10000)
  if (result.errorNote) console.error('sitemap-cards-1:', result.errorNote)

  return new NextResponse(renderCardSitemapXml(BASE_URL, result.cards), {
    headers: { 'Content-Type': 'application/xml' },
  })
}
