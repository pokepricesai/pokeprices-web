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
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const BATCH_START = 30000
  const BATCH_END = 50000
  const PAGE_SIZE = 1000
  let allCards: any[] = []

  for (let offset = BATCH_START; offset < BATCH_END; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('cards')
      .select('card_url_slug, set_name')
      .not('card_url_slug', 'is', null)
      .not('set_name', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('sitemap-cards-4 error at offset ' + offset + ':', error)
      break
    }
    if (!data || data.length === 0) break
    allCards = allCards.concat(data)
    if (data.length < PAGE_SIZE) break
  }

  const now = new Date().toISOString()
  const urls = allCards
    .filter((c: any) => c.card_url_slug && c.set_name)
    .map((c: any) => '  <url>\n    <loc>' + BASE_URL + '/set/' + encodeURIComponent(c.set_name) + '/card/' + c.card_url_slug + '</loc>\n    <lastmod>' + now + '</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.75</priority>\n  </url>')
    .join('\n')

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>'

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  })
}
