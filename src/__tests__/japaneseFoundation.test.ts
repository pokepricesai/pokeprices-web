// Block 5A-W-48B — source-invariant tests for the Japanese foundation.
//
// Live schema + RPC changes ship via the migration in
// migrations/2026-07-29-japanese-foundation.sql; those need Supabase
// SQL Editor to apply. The tests here pin the web-side wiring that
// must line up with that migration:
//
//   1. Every game pool query is gated to language='en' so Japanese
//      pilot cards never surface in Guess the Price / Higher or Lower
//      / Build a Binder / Guess the Card / Daily Pick before we
//      decide on a Japanese game mode.
//   2. Portfolio + watchlist upserts include set_name in the conflict
//      key so English and Japanese Pikachu can coexist under the
//      same user.
//   3. The card-page eBay CTA dispatches intent='japanese' for jp
//      cards and intent='raw' for en (preserves the existing behaviour).
//   4. The JapaneseBadge component renders nothing for en / undefined
//      and renders "Japanese" for jp.
//   5. Browse page carries a language tab strip + tile pill.
//   6. Set page reads set_metadata.language and shows the JapaneseBadge.
//   7. No new /ja routes exist; no translation infrastructure was
//      introduced.
//   8. The scraper seeder (sister repo) exposes --language en|jp.
//   9. Existing thin-page indexability gate applies to JP cards too.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import JapaneseBadge from '@/components/JapaneseBadge'

// ── 1. Games language gate ───────────────────────────────

describe('W48B — every game filters popular_card_trends to language=en', () => {
  const GAME_CLIENTS: { name: string; path: string }[] = [
    { name: 'Guess the Price',   path: 'src/app/games/guess-price/GuessPriceClient.tsx' },
    { name: 'Higher or Lower',   path: 'src/app/games/higher-lower/HigherLowerClient.tsx' },
    { name: 'Build a Binder',    path: 'src/app/games/build-a-binder/BuildABinderClient.tsx' },
    { name: 'Guess the Card',    path: 'src/app/games/guess-the-card/GuessTheCardClient.tsx' },
    { name: 'Daily Pick',        path: 'src/app/games/daily-pick/DailyPickClient.tsx' },
  ]

  for (const g of GAME_CLIENTS) {
    it(`${g.name}: pool query includes .eq('language', 'en')`, () => {
      const src = readFileSync(join(process.cwd(), g.path), 'utf8')
      // The .from('popular_card_trends') call in the loader must be
      // followed (before order/limit) by an .eq('language', 'en') gate.
      expect(src).toContain("popular_card_trends")
      expect(src).toMatch(/\.eq\(['"]language['"],\s*['"]en['"]\)/)
    })
  }
})

// ── 2. Portfolio + watchlist conflict targets ────────────

describe('W48B — portfolio_items upsert includes set_name_snapshot in the conflict key', () => {
  const PORTFOLIO_FILES = [
    'src/app/dashboard/portfolio/PortfolioDashboard.tsx',
    'src/components/CardQuickActions.tsx',
  ]
  for (const f of PORTFOLIO_FILES) {
    it(`${f} — onConflict lists set_name_snapshot`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      // No un-guarded pre-W48B conflict string may linger.
      expect(src).not.toMatch(/onConflict:\s*['"]portfolio_id,card_slug,holding_type['"]/)
      // New conflict includes set_name_snapshot.
      expect(src).toMatch(/onConflict:\s*['"]portfolio_id,card_slug,set_name_snapshot,holding_type['"]/)
    })
  }
})

describe('W48B — portfolio "already exists" lookups also match on set_name_snapshot', () => {
  it('handleAddCard cap gate matches set_name_snapshot', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/dashboard/portfolio/PortfolioDashboard.tsx'), 'utf8',
    )
    // Both the pre-add existence check and the scanner quick-add
    // check must match set_name_snapshot.
    expect(src).toMatch(/\.eq\(['"]set_name_snapshot['"],\s*itemData\.set_name_snapshot/)
    expect(src).toMatch(/\.eq\(['"]set_name_snapshot['"],\s*card\.set_name\)/)
  })
})

describe('W48B — watchlist "already watched" lookups match set_name', () => {
  it('CardQuickActions performs set_name-aware existence checks', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/CardQuickActions.tsx'), 'utf8',
    )
    // Both the useEffect load and the perform-add existence check
    // must include an .eq('set_name', card.set_name).
    const setNameChecks = src.match(/\.eq\(['"]set_name['"],\s*card\.set_name\)/g) ?? []
    expect(setNameChecks.length).toBeGreaterThanOrEqual(2)
  })
})

// ── 3. Affiliate wiring — intent='japanese' when card.language==='jp' ──

describe('W48B — eBay CTA routes Japanese cards through the Japanese intent', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/affiliate/EbayCardPrimaryAction.tsx'), 'utf8',
  )
  it('accepts a language prop', () => {
    expect(src).toContain("language?:   'en' | 'jp'")
  })
  it('picks intent based on language', () => {
    expect(src).toMatch(/intent\s*=\s*props\.language\s*===\s*['"]jp['"]\s*\?\s*['"]japanese['"]/)
  })
  it('picks a Japanese-aware label for jp cards', () => {
    expect(src).toContain('Find this Japanese card on eBay')
  })

  it('CardPageClient passes the resolved language to the CTA', () => {
    const client = readFileSync(
      join(process.cwd(), 'src/app/set/[slug]/card/[cardSlug]/CardPageClient.tsx'), 'utf8',
    )
    // Uses the shared resolveLanguage helper so the pilot works with
    // OR without the RPC extension.
    expect(client).toMatch(/<EbayCardPrimaryAction[\s\S]*?language=\{resolveLanguage\(card\.language as any, card\.set_name\)\}/)
  })
})

// ── 4. JapaneseBadge — renders only for jp ───────────────

describe('W48B — JapaneseBadge component', () => {
  it('renders null for undefined language', () => {
    const out = JapaneseBadge({ language: undefined })
    expect(out).toBeNull()
  })
  it('renders null for language=en', () => {
    const out = JapaneseBadge({ language: 'en' })
    expect(out).toBeNull()
  })
  it('renders null for null language', () => {
    const out = JapaneseBadge({ language: null })
    expect(out).toBeNull()
  })
  it('renders a Japanese label for language=jp', () => {
    const out = JapaneseBadge({ language: 'jp' })
    expect(out).not.toBeNull()
    // React element with children === 'Japanese'
    const children = (out as any)?.props?.children
    expect(children).toBe('Japanese')
    // aria-label present.
    expect((out as any)?.props?.['aria-label']).toBe('Japanese-language printing')
  })
  it('renders a smaller variant when size="sm"', () => {
    const md = JapaneseBadge({ language: 'jp', size: 'md' })
    const sm = JapaneseBadge({ language: 'jp', size: 'sm' })
    expect((md as any)?.props?.style?.fontSize).toBe(10)
    expect((sm as any)?.props?.style?.fontSize).toBe(9)
  })
})

// ── 5. Browse page carries a language tab strip + tile pill ──

describe('W48B — browse page', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/app/browse/BrowsePageClient.tsx'), 'utf8',
  )
  it('SetInfo type includes an optional language field', () => {
    expect(src).toMatch(/language\?:\s*string\s*\|\s*null/)
  })
  it('renders a language tab strip when jp sets exist', () => {
    expect(src).toContain('LanguageFilter')
    expect(src).toContain("jpSetCount")
    expect(src).toContain("role=\"tablist\"")
    expect(src).toContain("aria-label=\"Filter sets by language\"")
  })
  it('defaults the tab to English (does not disrupt existing browsing)', () => {
    expect(src).toMatch(/useState<LanguageFilter>\('en'\)/)
  })
  it('renders a JP pill on individual JP tiles', () => {
    expect(src).toMatch(/aria-label="Japanese-language set"/)
  })
})

// ── 6. Set page reads set_metadata.language + shows badge ──

describe('W48B — set page reads language + renders badge', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/app/set/[slug]/SetPageClient.tsx'), 'utf8',
  )
  it('reads set_metadata.language defensively', () => {
    expect(src).toContain("from('set_metadata').select('language')")
    expect(src).toContain('setSetLanguage')
  })
  it('threads the resolved language through SetHeader and mounts JapaneseBadge', () => {
    // resolveLanguage prefers set_metadata.language when the RPC path
    // succeeds and falls back to the "Japanese " prefix otherwise.
    expect(src).toContain('language={resolveLanguage(setLanguage, setName)}')
    expect(src).toContain('<JapaneseBadge language={language} size="md" />')
  })
})

// ── 7. Card page: language passthrough on CardRow + Quick Facts row ──

describe('W48B — card page carries the language through the type + UI', () => {
  it('CardRow type has an optional language field', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/set/[slug]/card/[cardSlug]/page.tsx'), 'utf8',
    )
    expect(src).toMatch(/language\?:\s*string\s*\|\s*null/)
  })
  it('CardPageClient renders JapaneseBadge above the H1', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/set/[slug]/card/[cardSlug]/CardPageClient.tsx'), 'utf8',
    )
    expect(src).toContain("import JapaneseBadge from '@/components/JapaneseBadge'")
    // The badge receives the resolved language (explicit || derived),
    // so it renders both for imported JP cards (once the RPC returns
    // language) and for JP cards whose set_name follows the pilot
    // "Japanese <title>" convention.
    expect(src).toMatch(/const cardLang = resolveLanguage\(card\.language as any, card\.set_name\)/)
    expect(src).toMatch(/<JapaneseBadge language=\{cardLang\}/)
    // The Quick Facts row includes an inline "· Language: Japanese".
    expect(src).toContain('Language: Japanese')
  })
})

// ── 8. Regression guard: no /ja routes, no multilingual chrome ──

describe('W48B — no multilingual infrastructure is introduced', () => {
  it('no /app/ja route folder exists', () => {
    expect(existsSync(join(process.cwd(), 'src/app/ja'))).toBe(false)
  })
  it('no hreflang metadata added anywhere', () => {
    // Guard against a hreflang leak — the block brief explicitly
    // forbids it. We scan the two files most likely to introduce it.
    const pageSrc = readFileSync(
      join(process.cwd(), 'src/app/set/[slug]/card/[cardSlug]/page.tsx'), 'utf8',
    )
    const setSrc = readFileSync(
      join(process.cwd(), 'src/app/set/[slug]/page.tsx'), 'utf8',
    )
    expect(pageSrc).not.toContain('hreflang')
    expect(setSrc).not.toContain('hreflang')
  })
})

// ── 9. Sister-repo scraper: --language flag exists ──

describe('W48B — sister-repo scraper supports --language en|jp', () => {
  it('seed_set_cards.py exposes an ALLOWED_LANGUAGES tuple + --language argparse flag', () => {
    const path = 'C:\\Users\\lukep\\OneDrive\\Desktop\\pokeprices\\seed_set_cards.py'
    if (!existsSync(path)) {
      // The scraper repo is co-located but may not be present in every
      // dev environment — this is a "skip" pattern where we just
      // record the observation rather than fail the whole suite.
      return
    }
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('ALLOWED_LANGUAGES = ("en", "jp")')
    expect(src).toMatch(/--language[\s\S]*?choices=list\(ALLOWED_LANGUAGES\)[\s\S]*?default="en"/)
    expect(src).toContain('upsert_set_metadata')
    // The console-name guard exists too.
    expect(src).toContain('--require-console')
  })
  it('pokeprices_scraper_v8.py emits a warning on Japanese console-names', () => {
    const path = 'C:\\Users\\lukep\\OneDrive\\Desktop\\pokeprices\\pokeprices_scraper_v8.py'
    if (!existsSync(path)) return
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('japanese_consoles')
    expect(src).toContain('Japanese-labelled console-name(s) detected')
  })
})

// ── 10. AI edge function prompt: Japanese-support instruction updated ──

describe('W48B — AI edge function prompt supports Japanese cards natively', () => {
  const path = 'pokeprices-chat-edge-function.ts'
  it('exists and is updated', () => {
    expect(existsSync(join(process.cwd(), path))).toBe(true)
  })
  it('removes the "English market prices may not apply" fallback advice', () => {
    const src = readFileSync(join(process.cwd(), path), 'utf8')
    // The previous prompt told users English prices might not apply.
    // Now that Japanese sets are supported natively that advice is
    // wrong and would confuse collectors — must be gone.
    expect(src).not.toContain('English market prices may not apply')
  })
  it('adds explicit "do not substitute English printing" guidance', () => {
    const src = readFileSync(join(process.cwd(), path), 'utf8')
    expect(src).toContain('DO NOT substitute the English printing')
    expect(src).toContain('never claim English and Japanese prices are interchangeable')
  })
  it('adds the "Japanese <set title>" naming convention hint', () => {
    const src = readFileSync(join(process.cwd(), path), 'utf8')
    expect(src).toContain('set names that begin with "Japanese "')
    expect(src).toContain('Japanese Battle Partners')
  })
  it('renames the section header away from the older "DETECTION" framing', () => {
    const src = readFileSync(join(process.cwd(), path), 'utf8')
    expect(src).toContain('JAPANESE CARD HANDLING')
    expect(src).not.toContain('JAPANESE CARD DETECTION')
  })
})

// ── 11. RPC-helpers companion migration exists ──

describe('W48B — companion RPC-helpers migration is committed', () => {
  const path = 'migrations/2026-07-29-japanese-foundation-rpc-helpers.sql'
  it('exists', () => {
    expect(existsSync(join(process.cwd(), path))).toBe(true)
  })
  const mig = existsSync(join(process.cwd(), path))
    ? readFileSync(join(process.cwd(), path), 'utf8') : ''
  it('adds get_set_languages() and get_card_language_by_url_slug()', () => {
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.get_set_languages()')
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.get_card_language_by_url_slug')
  })
  it('does NOT touch search_global or get_set_list_v2 (safety guarantee)', () => {
    expect(mig).not.toMatch(/CREATE[^\n]*FUNCTION[^\n]*search_global/)
    expect(mig).not.toMatch(/CREATE[^\n]*FUNCTION[^\n]*get_set_list_v2/)
    expect(mig).not.toMatch(/DROP[^\n]*FUNCTION[^\n]*search_global/)
    expect(mig).not.toMatch(/DROP[^\n]*FUNCTION[^\n]*get_set_list_v2/)
  })
  it('grants EXECUTE to anon so anonymous browsers get JP badges too', () => {
    expect(mig).toContain('GRANT EXECUTE ON FUNCTION public.get_set_languages() TO anon')
    expect(mig).toContain('GRANT EXECUTE ON FUNCTION public.get_card_language_by_url_slug(TEXT, TEXT) TO anon')
  })
})

// ── 12. Foundation migration correctness fixes ──

describe('W48B — foundation migration is safe against production data', () => {
  const mig = readFileSync(
    join(process.cwd(), 'migrations/2026-07-29-japanese-foundation.sql'), 'utf8',
  )
  it('does NOT ALTER watchlist_alert_overrides (that table has no set_name column)', () => {
    // Live schema check on 2026-07-29: watchlist_alert_overrides
    // columns are id, user_id, card_slug, enabled, ... — no set_name.
    // Attempting to add a (user_id, card_slug, set_name) UNIQUE
    // constraint would fail; the section was intentionally deferred.
    expect(mig).not.toMatch(/ALTER TABLE public\.watchlist_alert_overrides\s+ADD CONSTRAINT/)
    expect(mig).not.toMatch(/UNIQUE \(user_id, card_slug, set_name\)[\s\S]{0,100}watchlist_alert_overrides/)
    expect(mig).toContain('Deferred to W48C')
  })
})

// ── 13. Seeder writes release_year, not release_date ─────────

describe('W48B — seeder writes set_metadata columns that actually exist', () => {
  const path = 'C:\\Users\\lukep\\OneDrive\\Desktop\\pokeprices\\seed_set_cards.py'
  it('uses release_year (integer), not release_date', () => {
    if (!existsSync(path)) return
    const src = readFileSync(path, 'utf8')
    // Live schema on 2026-07-29: set_metadata columns are id,
    // set_name, release_year, total_cards, has_first_edition, ...
    // There is NO release_date column — the previous seeder draft
    // would have failed.
    expect(src).toContain('release_year')
    // The payload must not send release_date.
    expect(src).not.toMatch(/["']release_date["']\s*:/)
  })
  it('also seeds total_cards from --printed-total', () => {
    if (!existsSync(path)) return
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('"total_cards"')
  })
  it('retries the set_metadata upsert without language on failure (pre-migration)', () => {
    if (!existsSync(path)) return
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('Retrying without language field')
  })
})

// ── 14. Client-side language fallback wired everywhere it matters ──

describe('W48B — resolveLanguage prefix-fallback is wired into every JP surface', () => {
  const FILES: readonly string[] = [
    'src/components/SearchBar.tsx',
    'src/app/browse/BrowsePageClient.tsx',
    'src/app/set/[slug]/SetPageClient.tsx',
    'src/app/set/[slug]/card/[cardSlug]/CardPageClient.tsx',
  ]
  for (const f of FILES) {
    it(`${f} imports resolveLanguage`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src).toContain("from '@/lib/cardLanguage'")
      expect(src).toMatch(/resolveLanguage\s*\(/)
    })
  }
  it('SearchBar computes language from both explicit and derived paths', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/SearchBar.tsx'), 'utf8',
    )
    expect(src).toMatch(/resolveLanguage\(r\.language,\s*setNameForLang\)/)
  })
})

// ── 15. Foundation migration file (existing block, kept intact) ──

describe('W48B — foundation migration exists in the migrations directory', () => {
  const mig = readFileSync(
    join(process.cwd(), 'migrations/2026-07-29-japanese-foundation.sql'), 'utf8',
  )
  it('adds language column to cards + set_metadata (default en, CHECK en/jp)', () => {
    expect(mig).toContain("ADD COLUMN language TEXT NOT NULL DEFAULT 'en'")
    expect(mig).toContain("CHECK (language IN ('en', 'jp'))")
    expect(mig).toContain('table_name = \'cards\' AND column_name = \'language\'')
    expect(mig).toContain('table_name = \'set_metadata\' AND column_name = \'language\'')
  })
  it('extends provider_card_links CHECK to include jp', () => {
    expect(mig).toContain("provider_card_links_language_check")
    expect(mig).toMatch(/CHECK\s*\(language IN \('en', 'jp'\)\)/)
  })
  it('rewrites watchlist and portfolio_items uniqueness by set_name / set_name_snapshot', () => {
    expect(mig).toContain('watchlist_user_card_set_uniq')
    expect(mig).toContain('UNIQUE (user_id, card_slug, set_name)')
    expect(mig).toContain('idx_portfolio_items_unique_holding')
    expect(mig).toContain('(portfolio_id, card_slug, set_name_snapshot, holding_type)')
  })
  it('rebuilds popular_card_trends with c.language selected', () => {
    expect(mig).toContain('DROP VIEW IF EXISTS public.popular_card_trends')
    expect(mig).toContain('c.language')
  })
  it('republishes get_card_detail_by_url_slug and scan_card_match with language', () => {
    expect(mig).toContain("'language',              c.language")
    // scan_card_match RETURNS TABLE now ends with `language text`.
    expect(mig).toMatch(/RETURNS TABLE[\s\S]{0,2000}language\s+text\s*\)/)
  })
  it('a preflight file is provided so Luke can verify zero JP leakage first', () => {
    expect(existsSync(
      join(process.cwd(), 'migrations/2026-07-29-japanese-foundation-preflight.sql'),
    )).toBe(true)
  })
  it('includes a rollback plan in the comments', () => {
    expect(mig).toContain('Rollback plan')
    expect(mig).toContain('DROP COLUMN IF EXISTS language')
  })
})

// ── W48C — displaySetName wiring across every JP surface ───────

describe('W48C — displaySetName wired into every visible JP surface', () => {
  const CARD_PAGE_SRC = readFileSync(
    join(process.cwd(), 'src/app/set/[slug]/card/[cardSlug]/CardPageClient.tsx'), 'utf8',
  )
  const SET_PAGE_SRC = readFileSync(
    join(process.cwd(), 'src/app/set/[slug]/SetPageClient.tsx'), 'utf8',
  )
  const BROWSE_SRC = readFileSync(
    join(process.cwd(), 'src/app/browse/BrowsePageClient.tsx'), 'utf8',
  )
  const SEARCH_SRC = readFileSync(
    join(process.cwd(), 'src/components/SearchBar.tsx'), 'utf8',
  )
  const WATCHLIST_SRC = readFileSync(
    join(process.cwd(), 'src/app/dashboard/watchlist/WatchlistClient.tsx'), 'utf8',
  )
  const PORTFOLIO_SRC = readFileSync(
    join(process.cwd(), 'src/app/dashboard/portfolio/PortfolioDashboard.tsx'), 'utf8',
  )
  const SCANNER_SRC = readFileSync(
    join(process.cwd(), 'src/components/CardScanner.tsx'), 'utf8',
  )
  const SEO_SRC = readFileSync(
    join(process.cwd(), 'src/lib/seo-helpers.ts'), 'utf8',
  )
  const PAGE_SRC = readFileSync(
    join(process.cwd(), 'src/app/set/[slug]/card/[cardSlug]/page.tsx'), 'utf8',
  )

  for (const [label, src] of [
    ['card page client',    CARD_PAGE_SRC],
    ['set page client',     SET_PAGE_SRC],
    ['browse page client',  BROWSE_SRC],
    ['search bar',          SEARCH_SRC],
    ['watchlist client',    WATCHLIST_SRC],
    ['portfolio dashboard', PORTFOLIO_SRC],
    ['card scanner',        SCANNER_SRC],
  ] as const) {
    it(`${label} imports displaySetName`, () => {
      expect(src).toContain('displaySetName')
      expect(src).toContain("from '@/lib/cardLanguage'")
    })
  }

  it('card page metadata uses displaySetName + jpMarker for JP printings', () => {
    // Server-side generateMetadata now strips "Japanese " from the visible
    // set label AND injects a " Japanese" market marker into the title so
    // search snippets remain unambiguous.
    expect(PAGE_SRC).toContain('displaySetName')
    expect(PAGE_SRC).toContain('jpMarker')
    expect(PAGE_SRC).toMatch(/jpMarker\s*=\s*cardLang === 'jp' \? ' Japanese' : ''/)
  })

  it('set-page SEO helper uses cleaned name + Japanese marker for JP sets', () => {
    // For a JP set the title reads e.g. "Battle Partners Japanese Card
    // List & Prices …" — the market marker sits AFTER the set name.
    expect(SEO_SRC).toContain('isJp')
    expect(SEO_SRC).toContain("visible = isJp ? safeName.slice('Japanese '.length) : safeName")
    expect(SEO_SRC).toContain('jpMarker')
    expect(SEO_SRC).toMatch(/canonical\s*=\s*`\$\{SITE\}\/set\/\$\{slug \?\? encodeURIComponent\(safeName\)\}`/)
  })

  it('canonical URLs still use the internal Japanese-prefixed identity', () => {
    // Card page canonical takes `slug` (a URL param) — unchanged.
    // Set page canonical takes safeName (internal set_name) — unchanged.
    // Neither strips "Japanese " from the URL.
    expect(SEO_SRC).not.toMatch(/canonical[\s\S]{0,120}displaySetName/)
  })

  it('card page renders JapaneseBadge in the H1 area (unchanged from W48B)', () => {
    expect(CARD_PAGE_SRC).toMatch(/<JapaneseBadge\b/)
  })
  it('watchlist rows render the JapaneseBadge alongside the clean set label', () => {
    expect(WATCHLIST_SRC).toContain('<JapaneseBadge')
    expect(WATCHLIST_SRC).toMatch(/displaySetName\(item\.set_name/)
  })
  it('portfolio rows render the JapaneseBadge alongside the clean set label', () => {
    expect(PORTFOLIO_SRC).toContain('<JapaneseBadge')
    expect(PORTFOLIO_SRC).toMatch(/displaySetName\(item\.set_name/)
  })
  it('scanner candidates render the JapaneseBadge alongside the clean set label', () => {
    expect(SCANNER_SRC).toContain('<JapaneseBadge')
    expect(SCANNER_SRC).toMatch(/displaySetName\(c\.set_name/)
  })

  it('browse tiles use displaySetName but tile hrefs use the internal set_name', () => {
    expect(BROWSE_SRC).toMatch(/displaySetName\(s\.set_name/)
    // href construction is byte-identical to pre-W48C: uses raw set_name.
    expect(BROWSE_SRC).toContain('href={`/set/${encodeURIComponent(s.set_name)}`}')
  })

  it('search fallback paths derive language + strip prefix on every match branch', () => {
    // 5 branches in SearchBar's fallback: 4 card branches + 1 set branch.
    // Each must derive language via resolveLanguage and use displaySetName
    // for its sublabel/label.
    const langLines = (SEARCH_SRC.match(/const lang = resolveLanguage\(null, [^)]+\)/g) || []).length
    expect(langLines).toBeGreaterThanOrEqual(4)
    const visSetLines = (SEARCH_SRC.match(/displaySetName\([^,)]+, lang\)/g) || []).length
    expect(visSetLines).toBeGreaterThanOrEqual(4)
  })
})

// ── W48C — internal identity + route preservation ─────────────

describe('W48C — internal set identity + routes preserved', () => {
  const SET_PAGE_SRC = readFileSync(
    join(process.cwd(), 'src/app/set/[slug]/SetPageClient.tsx'), 'utf8',
  )
  const CARD_PAGE_SRC = readFileSync(
    join(process.cwd(), 'src/app/set/[slug]/card/[cardSlug]/CardPageClient.tsx'), 'utf8',
  )
  it('set page breadcrumb + all navigation Links use raw setName / set_name', () => {
    // At least one navigation link must still use the un-cleaned name.
    expect(SET_PAGE_SRC).toContain('href={`/set/${encodeURIComponent(')
  })
  it('card page breadcrumb Link uses card.set_name (Japanese-prefixed) for href', () => {
    expect(CARD_PAGE_SRC).toContain('href={`/set/${encodeURIComponent(card.set_name)}`}')
  })
  it('no /ja route added', () => {
    expect(existsSync(join(process.cwd(), 'src/app/ja'))).toBe(false)
  })
})
