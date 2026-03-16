// app/sitemap.ts
// Master sitemap index — points to sub-sitemaps for each section

export default function sitemap() {
  const BASE_URL = 'https://www.pokeprices.io'
  const now = new Date()

  return [
    { url: `${BASE_URL}/sitemap-pages.xml`,   lastModified: now },
    { url: `${BASE_URL}/sitemap-sets.xml`,    lastModified: now },
    { url: `${BASE_URL}/sitemap-pokemon.xml`, lastModified: now },
    { url: `${BASE_URL}/sitemap-cards-1.xml`, lastModified: now },
    { url: `${BASE_URL}/sitemap-cards-2.xml`, lastModified: now },
    { url: `${BASE_URL}/sitemap-cards-3.xml`, lastModified: now },
    { url: `${BASE_URL}/sitemap-cards-4.xml`, lastModified: now },
    { url: `${BASE_URL}/sitemap-insights.xml`,lastModified: now },
  ]
}
