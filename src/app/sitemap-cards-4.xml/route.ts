// app/sitemap-cards-4.xml/route.ts
// ┌──────────────────────────────────────────────────────────────────────┐
// │ ⚠ HARD CAP: the four cards-N.xml routes cover rows 0–49,999 only.    │
// │ Any card with an offset ≥ 50,000 is SILENTLY DROPPED from indexing.  │
// │ As of audit on 2026-05-18 the cards table held ~40,953 rows in       │
// │ this sitemap, leaving ~9k headroom. Once the count crosses 50k,      │
// │ new cards stop being submitted to Google.                            │
// │                                                                      │
// │ Fix queued separately: replace this hand-sliced sharding with a      │
// │ dynamic [n].xml route that emits as many shards as needed.           │
// └──────────────────────────────────────────────────────────────────────┘
//
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

  const result = await fetchIndexableCardBatch(supabase, 30000, 50000)
  if (result.errorNote) console.error('sitemap-cards-4:', result.errorNote)

  return new NextResponse(renderCardSitemapXml(BASE_URL, result.cards), {
    headers: { 'Content-Type': 'application/xml' },
  })
}
