// app/sitemap-pokemon.xml/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  let allSpecies: any[] = []
  let offset = 0
  const PAGE_SIZE = 1000

  while (true) {
    const { data, error } = await supabase
      .from('pokemon_species')
      .select('name')
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) { console.error('sitemap-pokemon error:', error); break }
    if (!data || data.length === 0) break
    allSpecies = allSpecies.concat(data)
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const pokeSlug = (name: string) => name
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')

  const now = new Date().toISOString()
  const urls = allSpecies
    .map((s: any) => pokeSlug(s.name))
    .filter((slug: string) => slug.length > 0)
    .map((slug: string) =>
      '  <url>\n    <loc>' + BASE_URL + '/pokemon/' + slug + '</loc>\n    <lastmod>' + now + '</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>'
    ).join('\n')

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>'

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } })
}
