// app/sitemap-cards-5.xml/route.ts
// Block 5A-W-50D — fifth card sitemap shard covering row positions
// [50000, 100000) in the cards table ordered by id ASC.
//
// The prior four shards cover positions 1..50000 (four range windows
// of 10k, 10k, 10k, 20k respectively). Before this shard existed the
// last 14,813 rows in the id-ordered set — dominated by Japanese
// cards from the W48D bulk import — were silently absent from the
// sitemap because .range(offset, end) never advanced past position
// 50000.
//
// Sizing: the current tail contains ~14,813 rows; after the shared
// recent-price filter (~93% of them have a positive price in the
// last 7 days) the shard emits ~13,800 URLs. Comfortably under the
// 50k URL limit — the range window extends to 100000 to absorb the
// next ~35k rows of catalogue growth before another shard is needed.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchIndexableCardBatch, renderCardSitemapXml } from '@/lib/seo-indexability/sitemapCards'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const result = await fetchIndexableCardBatch(supabase, 50000, 100000)
  if (result.errorNote) console.error('sitemap-cards-5:', result.errorNote)

  return new NextResponse(renderCardSitemapXml(BASE_URL, result.cards), {
    headers: { 'Content-Type': 'application/xml' },
  })
}
