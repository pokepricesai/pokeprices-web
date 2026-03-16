// app/sitemap-insights.xml/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: insights, error } = await supabase
    .from('insights')
    .select('slug, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  if (error) console.error('sitemap-insights error:', error)

  const urls = (insights || []).map((a: any) =>
    `  <url>\n    <loc>${BASE_URL}/insights/${a.slug}</loc>\n    <lastmod>${new Date(a.published_at).toISOString()}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.65</priority>\n  </url>`
  ).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } })
}
