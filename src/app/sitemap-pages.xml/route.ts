// app/sitemap-pages.xml/route.ts
import { NextResponse } from 'next/server'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const now = new Date().toISOString()

  const pages = [
    // Core
    { url: BASE_URL,                          priority: '1.0', changefreq: 'daily'   },
    { url: `${BASE_URL}/browse`,              priority: '0.9', changefreq: 'daily'   },
    { url: `${BASE_URL}/pokemon`,             priority: '0.9', changefreq: 'weekly'  },
    { url: `${BASE_URL}/insights`,            priority: '0.8', changefreq: 'weekly'  },

    // Tool hubs + featured tools
    { url: `${BASE_URL}/tools`,               priority: '0.9', changefreq: 'weekly'  },
    { url: `${BASE_URL}/ai-assistant`,        priority: '0.8', changefreq: 'weekly'  },
    { url: `${BASE_URL}/dealer`,              priority: '0.6', changefreq: 'monthly' },
    { url: `${BASE_URL}/studio`,              priority: '0.5', changefreq: 'monthly' },

    // Visualisations
    { url: `${BASE_URL}/visualisations`,                 priority: '0.7', changefreq: 'weekly' },
    { url: `${BASE_URL}/visualisations/heatmap`,         priority: '0.6', changefreq: 'weekly' },
    { url: `${BASE_URL}/visualisations/risers-fallers`,  priority: '0.6', changefreq: 'daily'  },
    { url: `${BASE_URL}/visualisations/set-price-index`, priority: '0.6', changefreq: 'weekly' },

    // Games
    { url: `${BASE_URL}/games`,               priority: '0.7', changefreq: 'daily'   },
    { url: `${BASE_URL}/games/daily-pick`,    priority: '0.6', changefreq: 'daily'   },
    { url: `${BASE_URL}/games/guess-price`,   priority: '0.6', changefreq: 'weekly'  },
    { url: `${BASE_URL}/games/higher-lower`,  priority: '0.6', changefreq: 'weekly'  },

    // Community
    { url: `${BASE_URL}/creators`,            priority: '0.7', changefreq: 'weekly'  },
    { url: `${BASE_URL}/vendors`,             priority: '0.7', changefreq: 'weekly'  },

    // Card shows
    { url: `${BASE_URL}/card-shows`,          priority: '0.7', changefreq: 'weekly'  },
    { url: `${BASE_URL}/card-shows/uk`,       priority: '0.6', changefreq: 'weekly'  },
    { url: `${BASE_URL}/card-shows/us`,       priority: '0.6', changefreq: 'weekly'  },
    { url: `${BASE_URL}/card-shows/ca`,       priority: '0.6', changefreq: 'weekly'  },

    // About / project
    { url: `${BASE_URL}/roadmap`,             priority: '0.7', changefreq: 'weekly'  },

    // Footer / legal
    { url: `${BASE_URL}/contact`,             priority: '0.3', changefreq: 'monthly' },
    { url: `${BASE_URL}/privacy`,             priority: '0.3', changefreq: 'yearly'  },
    { url: `${BASE_URL}/terms`,               priority: '0.3', changefreq: 'yearly'  },
  ]

  const urls = pages.map(p =>
    '  <url>\n    <loc>' + p.url + '</loc>\n    <lastmod>' + now + '</lastmod>\n    <changefreq>' + p.changefreq + '</changefreq>\n    <priority>' + p.priority + '</priority>\n  </url>'
  ).join('\n')

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>'

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } })
}
