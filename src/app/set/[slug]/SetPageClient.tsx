'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, formatPrice } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'
import PriceChart from '@/components/PriceChart'
import { getSetAssets } from '@/lib/setAssets'
import SetStructuredData from '@/components/SetStructuredData'
import JapaneseBadge from '@/components/JapaneseBadge'
import { resolveLanguage, displaySetName } from '@/lib/cardLanguage'
// Block 5A-W-46B — BreadcrumbSchema moved to the parent server
// component (page.tsx) so it appears in initial HTML. Do NOT re-import
// here; a duplicate BreadcrumbList would invalidate the rich result.
import FAQ from '@/components/FAQ'
import { EbayInlineLink } from '@/components/EbayLiveListings'
import { buildCardEbayQuery, getEbayUkUrl, getEbayUsUrl } from '@/lib/ebayAffiliate'
import { getSetFaqItems } from '@/lib/faqs'
// Block 5A-W-50B — quick Watch + Portfolio actions inside every set-
// page card tile. Two per-set bulk queries provide membership state,
// so no per-tile watchlist/portfolio SELECT happens even for a set
// with 500+ cards.
import SetCardTileActions, { type TileCard } from '@/components/SetCardTileActions'
import AuthPromptModal, { type AuthPromptContext } from '@/components/AuthPromptModal'
import { CardPortfolioAddModal } from '@/components/CardQuickActions'
import { loadSetMembership, EMPTY_MEMBERSHIP, normaliseSlug, type SetMembership } from '@/lib/setPageMembership'
import { useUserPlan } from '@/lib/account/useUserPlan'
import { peekIntendedAction, consumeIntendedAction } from '@/lib/intendedAction'
import { performWatchlistAdd } from '@/lib/watchlistOps'
import { trackEvent } from '@/lib/analytics'

interface Card {
  card_slug: string
  card_name: string
  card_number: string
  set_name: string
  raw_usd: number | null
  psa9_usd: number | null
  psa10_usd: number | null
  image_url: string | null
  card_url_slug: string | null
  is_sealed: boolean
}

interface TrendCard {
  card_slug: string
  card_name: string
  card_url_slug: string | null
  raw_usd: number
  raw_pct_30d: number | null
  image_url: string | null
  volume_label?: string | null
}

interface PopStats {
  total_graded: number
  gem_rate: number
  total_psa10: number
}

type SortOption = 'raw_desc' | 'raw_asc' | 'psa10_desc' | 'name_asc' | 'number_asc'

const statValue: React.CSSProperties = {
  fontSize: 20, fontWeight: 700, color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif", lineHeight: 1,
}
const statLabel: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
  textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginTop: 2,
}

function formatSetAge(releaseDate: string): string {
  const release = new Date(releaseDate)
  const now = new Date()
  let years = now.getFullYear() - release.getFullYear()
  let months = now.getMonth() - release.getMonth()
  if (months < 0) { years--; months += 12 }
  if (years === 0) return months <= 1 ? 'New' : `${months}mo old`
  if (months === 0) return `${years}y old`
  return `${years}y ${months}mo old`
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', marginBottom: 12, fontFamily: "'Figtree', sans-serif" }}>
      {children}
    </div>
  )
}

function Panel({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '18px 20px', ...style }}>
      {children}
    </div>
  )
}

function MoverRow({ card, setName, positive }: { card: TrendCard; setName: string; positive: boolean }) {
  const href = card.card_url_slug ? `/set/${encodeURIComponent(setName)}/card/${card.card_url_slug}` : '#'
  const ebayQuery = buildCardEbayQuery(card.card_name, setName, null)
  const ebayCustomId = `mover-${(card.card_slug || '').toString().replace(/^pc-/, '') || card.card_url_slug || ''}`
  return (
    <div
      style={{ padding: '6px 8px', borderRadius: 8, transition: 'background 0.15s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        {card.image_url
          ? <img src={card.image_url} alt={card.card_name} style={{ width: 26, height: 36, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
          : <div style={{ width: 26, height: 36, background: 'var(--bg)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, color: 'var(--border)' }}>🃏</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>${card.raw_usd.toFixed(2)}</span>
            {card.volume_label && (
              <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600, fontFamily: "'Figtree', sans-serif" }}>{card.volume_label}</span>
            )}
          </div>
        </div>
        {card.raw_pct_30d != null && (
          <span style={{ fontSize: 12, fontWeight: 800, flexShrink: 0, color: positive ? 'var(--green)' : '#ef4444', fontFamily: "'Figtree', sans-serif" }}>
            {card.raw_pct_30d > 0 ? '+' : ''}{card.raw_pct_30d.toFixed(1)}%
          </span>
        )}
      </Link>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
        <EbayInlineLink searchQuery={ebayQuery} customId={ebayCustomId} />
      </div>
    </div>
  )
}

// Block 5A-W-50B — CardGrid now renders each tile as a wrapping
// <div> instead of a wrapping <Link>. This is required so the two
// action <button>s can live inside the same visual card without
// violating HTML nesting rules (buttons cannot appear inside an <a>).
// The clickable card body — image + name + prices — remains a Link;
// only the tiny action row at the bottom sits outside it. Clicking
// the image or the name still navigates to the card page exactly as
// before; the row of two buttons is the only new interactive surface.
type TileActionProps = React.ComponentProps<typeof SetCardTileActions>
function CardGrid({
  cards, setName, buildTileActionProps,
}: {
  cards: Card[]
  setName: string
  buildTileActionProps?: (c: Card) => TileActionProps | null
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
      {cards.map(c => {
        const actionProps = buildTileActionProps ? buildTileActionProps(c) : null
        return (
          <div
            key={c.card_slug}
            className="card-hover holo-shimmer"
            style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', padding: 14, color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
          >
            <Link
              href={`/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`}
              style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}
              aria-label={`Open ${c.card_name}`}
            >
              {c.image_url
                ? <img src={c.image_url} alt={c.card_name} style={{ width: 110, height: 154, objectFit: 'contain', marginBottom: 8, borderRadius: 6 }} loading="lazy" />
                : <div style={{ width: 110, height: 154, background: 'var(--bg)', borderRadius: 6, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'var(--border)' }}>{c.is_sealed ? '📦' : '🃏'}</div>}
              <div style={{ fontWeight: 600, fontSize: 13, textAlign: 'center', marginBottom: 3, lineHeight: 1.3, fontFamily: "'Figtree', sans-serif", display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {c.card_name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                {c.is_sealed ? 'Sealed' : 'Raw'}: {formatPrice(c.raw_usd)}
              </div>
              {!c.is_sealed && c.psa10_usd && c.psa10_usd > 0 && (
                <div style={{ fontSize: 12, color: 'var(--accent-hover)', fontWeight: 500, fontFamily: "'Figtree', sans-serif" }}>
                  PSA 10: {formatPrice(c.psa10_usd)}
                </div>
              )}
            </Link>
            {actionProps && <SetCardTileActions {...actionProps} />}
          </div>
        )
      })}
    </div>
  )
}

function SealedSection({
  sealedCards, setName, buildTileActionProps,
}: {
  sealedCards: Card[]
  setName: string
  buildTileActionProps?: (c: Card) => React.ComponentProps<typeof SetCardTileActions> | null
}) {
  if (sealedCards.length === 0) return null
  return (
    <div id="sealed" style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 700, letterSpacing: 0.5 }}>
          <span>📦</span><span>Sealed Product ({sealedCards.length})</span>
        </div>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 14, lineHeight: 1.6, background: 'var(--bg-light)', borderRadius: 8, padding: '10px 14px' }}>
        Sealed product prices track market value of unopened product — not individual cards.
      </p>
      <CardGrid cards={sealedCards} setName={setName} buildTileActionProps={buildTileActionProps} />
    </div>
  )
}

function SetHeader({ setName, releaseDate, language }: { setName: string; releaseDate: string | null; language?: string | null }) {
  const { logoUrl, symbolUrl, eraUrl, eraDisplay } = getSetAssets(setName)

  return (
    <div style={{ marginBottom: 20 }}>
      <Link
        href="/browse"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: 'var(--text)', fontSize: 13, textDecoration: 'none',
          marginBottom: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 600,
          padding: '6px 14px 6px 10px',
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 20, transition: 'all 0.15s',
        }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--primary)'; el.style.color = 'var(--primary)' }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text)' }}
      >
        <span style={{ fontSize: 11, opacity: 0.5 }}>←</span> Browse all sets
      </Link>

      {eraUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <img src={eraUrl} alt={eraDisplay ?? ''} style={{ height: 22, width: 'auto', objectFit: 'contain' }} loading="lazy" />
          {eraDisplay && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap' }}>
              {eraDisplay}
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {logoUrl && <img src={logoUrl} alt={displaySetName(setName, language)} style={{ height: 56, width: 'auto', objectFit: 'contain', maxWidth: 240 }} loading="eager" />}
        {symbolUrl && <img src={symbolUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} loading="lazy" />}
        {/* Block 5A-W-48C — visible H1 strips leading "Japanese ".
            Internal setName + canonical still use the Japanese-
            prefixed identifier; only the visible label is cleaned. */}
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: logoUrl ? 26 : 34, fontWeight: 700, margin: 0, color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1.2 }}>
          {displaySetName(setName, language)}
        </h1>
        {/* Block 5A-W-48B — pill flags Japanese sets. Renders nothing
            for English so English sets are unchanged visually. */}
        <JapaneseBadge language={language} size="md" />
      </div>

      {releaseDate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            Released {new Date(releaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
            background: 'var(--bg-light)', border: '1px solid var(--border)',
            borderRadius: 20, padding: '2px 10px', fontFamily: "'Figtree', sans-serif",
          }}>
            {formatSetAge(releaseDate)}
          </span>
        </div>
      )}
    </div>
  )
}

export default function SetPageClient({ slug }: { slug: string }) {
  const setName = decodeURIComponent(slug)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortOption>('raw_desc')
  const [releaseDate, setReleaseDate] = useState<string | null>(null)
  const [insight, setInsight] = useState<string | null>(null)
  const [priceHistory, setPriceHistory] = useState<any[]>([])
  const [popStats, setPopStats] = useState<PopStats | null>(null)
  const [topMovers, setTopMovers] = useState<TrendCard[]>([])
  const [topFallers, setTopFallers] = useState<TrendCard[]>([])
  const [topSealedMovers, setTopSealedMovers] = useState<TrendCard[]>([])
  const [error, setError] = useState(false)
  // Block 5A-W-48B — read set_metadata.language so the header pill
  // renders "Japanese" for JP sets. Missing / 'en' → nothing renders.
  const [setLanguage, setSetLanguage] = useState<string | null>(null)

  // ── Block 5A-W-50B — user, plan and per-set membership state for
  //    the tile actions. Two paginated queries per set-load;
  //    anonymous users skip both.
  const [user, setUser] = useState<{ id: string } | null>(null)
  const { plan } = useUserPlan(user?.id ?? null)
  const [membership, setMembership] = useState<SetMembership>(EMPTY_MEMBERSHIP)
  const [authPromptOpen, setAuthPromptOpen] = useState<AuthPromptContext | null>(null)
  const [portfolioModalCard, setPortfolioModalCard] = useState<{ card: TileCard; bareSlug: string } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? { id: session.user.id } : null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ? { id: session.user.id } : null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user?.id || !setName) { setMembership(EMPTY_MEMBERSHIP); return }
    let live = true
    loadSetMembership(supabase, user.id, setName).then(m => {
      if (live) setMembership(m)
    })
    return () => { live = false }
  }, [user?.id, setName])

  // Block 5A-W-50B-FIX1 — intent replay on the set page.
  //
  // If the user clicked Watch or Portfolio while logged out, we
  // stored the intent + redirected them to /dashboard/login with
  // returnTo=<this set page>. On return we peek the stored intent
  // and only consume it if origin_set_name matches THIS set. An
  // intent from another set is left alone so it can replay when the
  // user visits the matching set. Every acted-on intent is cleared,
  // whether the replay succeeds or fails, so nothing lingers.
  useEffect(() => {
    if (!user?.id || !setName) return
    const peeked = peekIntendedAction()
    if (!peeked) return
    const payload = peeked.payload as any
    const originSet: string | undefined = payload?.origin_set_name
    // Only act on set-page intents (must carry origin_set_name and
    // match the current set). Older card-page intents without the
    // origin field are handled by CardQuickActions on the card page.
    if (!originSet || originSet !== setName) return
    // Consume — clears whether we act or fail.
    consumeIntendedAction()

    if (peeked.type === 'watchlist_add') {
      ;(async () => {
        trackEvent('watchlist_add_attempt', {
          card_slug:        payload.card_slug,
          set_slug:         setName,
          source_component: 'set_tile_replay',
        })
        const id = await performWatchlistAdd(supabase, user.id, {
          card_slug:   payload.card_slug,
          card_name:   payload.card_name,
          set_name:    payload.set_name,
          image_url:   payload.image_url ?? null,
          card_number: payload.card_number ?? null,
          raw_usd:     payload.raw_usd    ?? null,
          psa10_usd:   payload.psa10_usd  ?? null,
        })
        if (id) {
          trackEvent('watchlist_add_success', {
            card_slug:        payload.card_slug,
            set_slug:         setName,
            source_component: 'set_tile_replay',
          })
          // Refresh membership so the tile flips to Watching.
          loadSetMembership(supabase, user.id, setName).then(setMembership)
        }
      })()
    } else if (peeked.type === 'portfolio_open') {
      // Open the existing portfolio modal with the intent card.
      const tileCard: TileCard = {
        card_slug:     payload.card_slug,
        card_name:     payload.card_name,
        card_number:   payload.card_number ?? null,
        set_name:      payload.set_name,
        raw_usd:       payload.raw_usd    ?? null,
        psa10_usd:     payload.psa10_usd  ?? null,
        image_url:     payload.image_url  ?? null,
        card_url_slug: payload.card_slug,
        is_sealed:     false,
      }
      setPortfolioModalCard({ card: tileCard, bareSlug: payload.card_slug })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, setName])

  const buildTileActionProps = (c: Card) => {
    // Block 5A-W-50B-FIX1 — sealed products (booster boxes, ETBs,
    // tins) don't have a matching holding_type in the portfolio
    // schema (HOLDING_TYPES covers raw + graded only), so we hide
    // the tile actions on sealed tiles. Sealed tiles keep their
    // normal navigation to the individual card page.
    if (c.is_sealed) return null
    const bareSlug = normaliseSlug(c.card_slug)
    return {
      card: {
        card_slug:     c.card_slug,
        card_name:     c.card_name,
        card_number:   c.card_number ?? null,
        set_name:      c.set_name,
        raw_usd:       c.raw_usd,
        psa10_usd:     c.psa10_usd,
        image_url:     c.image_url,
        card_url_slug: c.card_url_slug,
        is_sealed:     c.is_sealed,
      } as TileCard,
      bareSlug,
      user,
      plan,
      isWatched:     membership.watched.has(bareSlug),
      isInPortfolio: membership.inPortfolio.has(bareSlug),
      onWatchedChanged: (slug: string, watched: boolean) => {
        setMembership(prev => {
          const next = new Set(prev.watched)
          if (watched) next.add(slug); else next.delete(slug)
          return { ...prev, watched: next }
        })
      },
      onOpenAuthPrompt: (ctx: AuthPromptContext) => setAuthPromptOpen(ctx),
      onOpenPortfolio:  (card: TileCard, bareSlug: string) => {
        setPortfolioModalCard({ card, bareSlug })
      },
    }
  }

  useEffect(() => {
    async function loadData() {
      setLoading(true); setError(false)

      const { data, error: err } = await supabase.rpc('get_set_cards_sortable', { set_text: setName, sort_col: sort })
      if (err || !data) setError(true)
      else {
        const normalised = data.map((c: any) => ({
          ...c,
          is_sealed: c.is_sealed === true || c.is_sealed === 'true',
        }))
        setCards(normalised)
        const dateCard = normalised.find((c: any) => c.set_release_date)
        if (dateCard?.set_release_date) setReleaseDate(dateCard.set_release_date)
      }

      if (!releaseDate) {
        const { data: rdData } = await supabase
          .from('cards').select('set_release_date')
          .eq('set_name', setName).not('set_release_date', 'is', null)
          .limit(1).single()
        if (rdData?.set_release_date) setReleaseDate(rdData.set_release_date)
      }

      // Block 5A-W-48B — pull the language flag from set_metadata.
      // Safe defensively: if the column doesn't exist yet (pre-migration
      // deploy) the query errors and we fall through to null, which
      // renders as the existing English-styled header.
      try {
        const { data: metaLangData } = await supabase
          .from('set_metadata').select('language')
          .eq('set_name', setName).maybeSingle()
        if (metaLangData && (metaLangData as any).language) {
          setSetLanguage(((metaLangData as any).language ?? 'en').toString())
        }
      } catch {
        /* pre-migration deploys land here; silently leave setLanguage=null */
      }

      const { data: insightData } = await supabase.rpc('get_set_insight', { set_text: setName })
      if (insightData) setInsight(insightData)

      const { data: histData } = await supabase.rpc('get_set_price_history', { set_text: setName })
      if (histData) setPriceHistory(histData.map((d: any) => ({ ...d, value_usd: d.value_usd ? d.value_usd * 100 : null })))

      const { data: popData } = await supabase
        .from('psa_set_totals').select('*')
        .or(`set_name.eq.Pokemon ${setName},set_name.ilike.%${setName}%`)
        .order('snapshot_date', { ascending: false }).limit(1)
      if (popData && popData.length > 0) {
        const pop = popData[0]
        setPopStats({ total_graded: pop.total_graded || 0, gem_rate: pop.gem_rate || 0, total_psa10: pop.total_psa_10 || 0 })
      }

      // Fetch trends — join with card_volume to ensure min 1 sale/month
      const { data: trendData } = await supabase
        .from('card_trends').select('card_name, card_slug, current_raw, raw_pct_30d')
        .eq('set_name', setName).not('raw_pct_30d', 'is', null).gt('current_raw', 500)
        .order('raw_pct_30d', { ascending: false }).limit(200)

      if (trendData && trendData.length > 0) {
        const slugs = trendData.map((t: any) => t.card_slug)

        // Fetch images + sealed status + volume in parallel
        const [imgRes, volRes] = await Promise.all([
          supabase.from('cards').select('card_slug, image_url, card_url_slug, is_sealed').in('card_slug', slugs),
          supabase.from('card_volume').select('card_slug, sales_30d, volume_label').in('card_slug', slugs).eq('grade', 'Ungraded'),
        ])

        const imgMap: Record<string, any> = {}
        ;(imgRes.data || []).forEach((c: any) => { imgMap[c.card_slug] = c })

        const volMap: Record<string, any> = {}
        ;(volRes.data || []).forEach((v: any) => { volMap[v.card_slug] = v })

        const allEnriched = trendData
          .filter((t: any) => {
            // Must have at least 1 sale per month
            const vol = volMap[t.card_slug]
            return vol && vol.sales_30d >= 1
          })
          .map((t: any) => ({
            card_slug: t.card_slug,
            card_name: t.card_name,
            card_url_slug: imgMap[t.card_slug]?.card_url_slug ?? null,
            raw_usd: t.current_raw / 100,
            raw_pct_30d: t.raw_pct_30d,
            image_url: imgMap[t.card_slug]?.image_url ?? null,
            is_sealed: imgMap[t.card_slug]?.is_sealed === true || imgMap[t.card_slug]?.is_sealed === 'true',
            volume_label: volMap[t.card_slug]?.volume_label ?? null,
          }))

        const isReliable = (t: any) => Math.abs(t.raw_pct_30d ?? 0) <= 300
        const cardEnriched = allEnriched.filter((t: any) => !t.is_sealed)
        const sealedEnriched = allEnriched.filter((t: any) => t.is_sealed)

        setTopMovers(cardEnriched.filter((t: any) => (t.raw_pct_30d ?? 0) > 0 && isReliable(t)).slice(0, 5))
        setTopFallers(
          cardEnriched
            .filter((t: any) => (t.raw_pct_30d ?? 0) < 0 && isReliable(t))
            .sort((a: any, b: any) => (a.raw_pct_30d ?? 0) - (b.raw_pct_30d ?? 0))
            .slice(0, 5)
        )
        setTopSealedMovers(sealedEnriched.filter((t: any) => (t.raw_pct_30d ?? 0) > 0 && isReliable(t)).slice(0, 5))
      }

      setLoading(false)
    }
    loadData()
  }, [setName, sort])

  const regularCards = cards.filter(c => !c.is_sealed)
  const sealedCards = cards.filter(c => c.is_sealed)
  const cardsWithPrice = regularCards.filter(c => c.raw_usd && c.raw_usd > 0)
  const totalSetValue = cardsWithPrice.reduce((sum, c) => sum + (c.raw_usd || 0), 0)
  const avgCardValue = cardsWithPrice.length > 0 ? totalSetValue / cardsWithPrice.length : 0
  const cardsWithPsa10 = regularCards.filter(c => c.psa10_usd && c.psa10_usd > 0)
  const hasPop = !!(popStats && popStats.total_graded > 0)
  const hasMovers = topMovers.length > 0 || topFallers.length > 0 || topSealedMovers.length > 0

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 24px' }}>
      {/* Block 5A-W-46B — BreadcrumbSchema now emitted by page.tsx
          (server). SetStructuredData stays here until the set card
          list is fetched server-side too — do NOT swap that helper
          up without matching the fetch move. */}
      <SetStructuredData setName={setName} slug={encodeURIComponent(setName)} cards={regularCards} releaseDate={releaseDate} />
      {/* Block 5A-W-48B — resolveLanguage falls back to the "Japanese "
          name-prefix convention if set_metadata.language isn't yet
          returned (e.g. RPC fetch failed, or the migration isn't
          applied yet). This guarantees the JP badge appears for any
          Japanese pilot set imported by the seeder. */}
      <SetHeader setName={setName} releaseDate={releaseDate}
        language={resolveLanguage(setLanguage, setName)} />

      {/* ── Section jump links + eBay listing chips ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <a href="#cards" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 14px', textDecoration: 'none', color: 'var(--text)', fontSize: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 600, transition: 'border-color 0.15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--primary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)' }}>
          🃏 Cards {!loading && regularCards.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({regularCards.length})</span>}
        </a>
        {!loading && sealedCards.length > 0 && (
          <a href="#sealed" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 14px', textDecoration: 'none', color: 'var(--text)', fontSize: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 600, transition: 'border-color 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--primary)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)' }}>
            📦 Sealed Product <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({sealedCards.length})</span>
          </a>
        )}
        <a href={getEbayUkUrl(setName, `set-${setName}`)} target="_blank" rel="sponsored noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 14px', textDecoration: 'none', color: 'var(--text-muted)', fontSize: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 600, transition: 'border-color 0.15s, color 0.15s' }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--primary)'; el.style.color = 'var(--text)' }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text-muted)' }}>
          🇬🇧 UK Listings
        </a>
        <a href={getEbayUsUrl(setName, `set-${setName}`)} target="_blank" rel="sponsored noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 14px', textDecoration: 'none', color: 'var(--text-muted)', fontSize: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 600, transition: 'border-color 0.15s, color 0.15s' }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--primary)'; el.style.color = 'var(--text)' }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text-muted)' }}>
          🇺🇸 US Listings
        </a>
      </div>

      {/* ── Chat ── */}
      <div style={{ marginBottom: 20 }}>
        <InlineChat
          cardContext={setName}
          suggestedPrompts={[
            `What are the most valuable cards in ${setName}?`,
            `Is ${setName} worth investing in right now?`,
            `Which ${setName} cards are trending up?`,
            `What's the grading outlook for ${setName}?`,
          ]}
        />
      </div>

      {/* ── Set overview stats ── */}
      {!loading && cardsWithPrice.length > 0 && (
        <Panel style={{ marginBottom: 14 }}>
          <SectionLabel>Set Overview</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {[
              { val: regularCards.length.toString(), label: 'Total Cards' },
              { val: `$${(totalSetValue / 100).toFixed(0)}`, label: 'Complete Set Value' },
              { val: `$${(avgCardValue / 100).toFixed(2)}`, label: 'Avg Card (Raw)' },
              { val: cardsWithPsa10.length.toString(), label: 'Cards w/ PSA 10 Data' },
              ...(sealedCards.length > 0 ? [{ val: sealedCards.length.toString(), label: 'Sealed Products' }] : []),
              ...(hasPop && popStats ? [
                { val: popStats.total_graded.toLocaleString(), label: 'Total PSA Graded' },
                { val: `${popStats.gem_rate.toFixed(1)}%`, label: 'Set Gem Rate', color: popStats.gem_rate < 5 ? 'var(--green)' : undefined },
              ] : []),
            ].map(({ val, label, color }: any) => (
              <div key={label} style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ ...statValue, color: color ?? 'var(--text)' }}>{val}</div>
                <div style={statLabel}>{label}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Set insight ── */}
      {insight && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderLeft: '3px solid var(--primary)', borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--primary)', marginBottom: 7, fontFamily: "'Figtree', sans-serif" }}>Set Insight</div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', margin: 0, fontFamily: "'Figtree', sans-serif" }}>{insight}</p>
        </div>
      )}

      {/* ── Movers ── */}
      {hasMovers && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 14 }}>
          {topMovers.length > 0 && (
            <Panel>
              <SectionLabel>📈 Top Risers — Cards (30d)</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {topMovers.map((card, i) => <MoverRow key={i} card={card} setName={setName} positive />)}
              </div>
            </Panel>
          )}
          {topFallers.length > 0 && (
            <Panel>
              <SectionLabel>📉 Top Fallers — Cards (30d)</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {topFallers.map((card, i) => <MoverRow key={i} card={card} setName={setName} positive={false} />)}
              </div>
            </Panel>
          )}
          {topSealedMovers.length > 0 && (
            <Panel>
              <SectionLabel>📦 Top Risers — Sealed (30d)</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {topSealedMovers.map((card, i) => <MoverRow key={i} card={card} setName={setName} positive />)}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* ── PSA Population ── */}
      {hasPop && popStats && !insight && (
        <Panel style={{ marginBottom: 14 }}>
          <SectionLabel>PSA Population</SectionLabel>
          <div style={{ display: 'flex', gap: 24 }}>
            <div><div style={statValue}>{popStats.total_graded.toLocaleString()}</div><div style={statLabel}>Total Graded</div></div>
            <div><div style={statValue}>{popStats.total_psa10.toLocaleString()}</div><div style={statLabel}>PSA 10s</div></div>
            <div>
              <div style={{ ...statValue, color: popStats.gem_rate < 5 ? 'var(--green)' : 'var(--text)' }}>{popStats.gem_rate.toFixed(1)}%</div>
              <div style={statLabel}>Gem Rate</div>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Price Chart ── */}
      {priceHistory.length > 1 && (
        <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '20px 20px 32px', marginBottom: 16 }}>
          <SectionLabel>Set Price History</SectionLabel>
          <PriceChart data={priceHistory} series={[{ key: 'value_usd', color: 'var(--accent)', label: 'Total Set Value', defaultOn: true }]} height={220} />
        </div>
      )}

      {/* ── Sort + card count ── */}
      <div id="cards" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, fontFamily: "'Figtree', sans-serif" }}>
          {regularCards.length} cards
          {sealedCards.length > 0 && <span style={{ marginLeft: 6, opacity: 0.6 }}>· <a href="#sealed" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>{sealedCards.length} sealed ↓</a></span>}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(([
            ['raw_desc',   'Highest Raw'],
            ['raw_asc',    'Lowest Raw'],
            ['psa10_desc', 'Highest PSA 10'],
            ['name_asc',   'Name A-Z'],
            ['number_asc', 'Card #'],
          ] as [SortOption, string][]).map(([val, label]) => (
            <button key={val} className={`sort-btn ${sort === val ? 'active' : ''}`} onClick={() => setSort(val)} style={{ fontFamily: "'Figtree', sans-serif" }}>{label}</button>
          )))}
        </div>
      </div>

      {/* ── Card grid ── */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {Array.from({ length: 12 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 240, borderRadius: 12 }} />)}
        </div>
      ) : error ? (
        <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '40px 24px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif" }}>Could not load cards for this set. Try refreshing the page.</p>
        </div>
      ) : (
        <>
          <CardGrid cards={regularCards} setName={setName} buildTileActionProps={buildTileActionProps} />
          <SealedSection sealedCards={sealedCards} setName={setName} buildTileActionProps={buildTileActionProps} />
        </>
      )}

      {/* FAQ — visible content + FAQPage schema */}
      {!loading && regularCards.length > 0 && (
        <FAQ items={getSetFaqItems({
          setName,
          cards: regularCards,
          releaseDate,
          totalSetValueCents: totalSetValue,
          cardsTracked: regularCards.length,
        })} />
      )}

      {/* Block 5A-W-50B — shared modal state for the tile actions. */}
      <AuthPromptModal
        open={authPromptOpen !== null}
        context={authPromptOpen ?? 'watchlist'}
        returnTo={typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'}
        onClose={() => setAuthPromptOpen(null)}
      />
      {portfolioModalCard && user && (
        <CardPortfolioAddModal
          card={{
            card_slug:     portfolioModalCard.card.card_slug,
            card_name:     portfolioModalCard.card.card_name,
            set_name:      portfolioModalCard.card.set_name,
            card_url_slug: portfolioModalCard.card.card_url_slug,
            image_url:     portfolioModalCard.card.image_url,
            card_number:   portfolioModalCard.card.card_number,
            raw_usd:       portfolioModalCard.card.raw_usd,
            psa10_usd:     portfolioModalCard.card.psa10_usd,
          }}
          cardSlug={portfolioModalCard.bareSlug}
          user={user}
          onClose={() => {
            setPortfolioModalCard(null)
            // Refresh membership so the tile flips to "Owned" after
            // a successful add. Avoids per-tile queries by refreshing
            // just the two-query bulk load.
            if (user?.id) loadSetMembership(supabase, user.id, setName).then(setMembership)
          }}
        />
      )}
    </div>
  )
}