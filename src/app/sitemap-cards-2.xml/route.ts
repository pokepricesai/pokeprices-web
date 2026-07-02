// app/sitemap-cards-2.xml/route.ts
// Block 5A-W-35 — see sitemap-cards-1.xml/route.ts for policy notes.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchIndexableCardBatch, renderCardSitemapXml } from '@/lib/seo-indexability/sitemapCards'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const result = await fetchIndexableCardBatch(supabase, 10000, 20000)
  if (result.errorNote) console.error('sitemap-cards-2:', result.errorNote)

  return new NextResponse(renderCardSitemapXml(BASE_URL, result.cards), {
    headers: { 'Content-Type': 'application/xml' },
  })
}
