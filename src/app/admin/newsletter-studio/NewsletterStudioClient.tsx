'use client'

import { useEffect, useState } from 'react'
import { supabase, CHAT_ENDPOINT } from '@/lib/supabase'

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ── Admin password gate (mirrors /admin/content-studio) ──────────────────

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pokeprices2024'
const SESSION_KEY = 'pp_newsletter_studio_authed'

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) {
      try { sessionStorage.setItem(SESSION_KEY, '1') } catch {}
      onLogin()
    } else { setErr(true); setPw('') }
  }

  return (
    <div style={{ maxWidth: 380, margin: '120px auto', padding: 24, background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)', fontFamily: "'Figtree', sans-serif" }}>
      <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>Newsletter Studio</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>Admin password required.</p>
      <form onSubmit={handleSubmit}>
        <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(false) }} placeholder="Password"
          style={{ width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10, border: `1px solid ${err ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg-light)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }} />
        {err && <p style={{ fontSize: 12, color: '#ef4444', margin: '8px 0 0' }}>Wrong password.</p>}
        <button type="submit" style={{ width: '100%', marginTop: 12, padding: '10px 14px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Enter
        </button>
      </form>
    </div>
  )
}

// ── Data shapes ───────────────────────────────────────────────────────────

type Mover = {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  current_price: number   // cents
  pct_change: number      // percent
}

type HiddenGem = {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url?: string | null
  current_price: number   // cents
  pct_30d: number | null
  psa10_pop: number
  gem_score: number
  current_psa10?: number | null
  current_raw?: number | null
}

type TrendingSet = {
  set_name: string
  card_count: number
  avg_raw_usd: number
  total_raw_usd: number
  avg_pct_30d: number
  avg_pct_90d: number
  total_pct_30d: number
  total_pct_90d: number
}

type GradingPick = {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  current_raw: number
  current_psa10: number
  premium_multiple: number   // psa10 / raw
}

type NewsletterData = {
  generatedAt: Date
  totalMarketUsd: number     // cents
  cardsTracked: number
  pct30d: number | null
  risers: Mover[]
  fallers: Mover[]
  hiddenGem: HiddenGem | null
  gradingPick: GradingPick | null
  trendingSets: TrendingSet[]
  marketInsight: string
}

// ── Helpers ───────────────────────────────────────────────────────────────

const SEALED_PATTERNS = [
  /booster box/i, /booster pack/i, /elite trainer/i, /\betb\b/i,
  /collection box/i, /\btin\b/i, /topps/i, /display box/i,
  /stadium/i, /build.*battle/i,
]
function isSealed(name: string, setName: string) {
  return SEALED_PATTERNS.some(p => p.test(name || '') || p.test(setName || ''))
}

function fmtUsdCents(cents: number, includeFractional = false): string {
  const d = cents / 100
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}k`
  if (d >= 100)       return `$${d.toFixed(0)}`
  return includeFractional ? `$${d.toFixed(2)}` : `$${d.toFixed(0)}`
}

function fmtPrice(cents: number): string {
  const d = cents / 100
  if (d >= 1000) return `$${Math.round(d).toLocaleString('en-US')}`
  if (d >= 100)  return `$${Math.round(d)}`
  return `$${d.toFixed(2)}`
}

function cardUrl(setName: string, urlSlug: string | null, fallbackSlug: string): string {
  return `https://www.pokeprices.io/set/${encodeURIComponent(setName)}/card/${urlSlug || fallbackSlug}`
}

function setUrl(setName: string): string {
  return `https://www.pokeprices.io/set/${encodeURIComponent(setName)}`
}

function thisWeekLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Data fetch ────────────────────────────────────────────────────────────

async function fetchMovers(direction: 'rising' | 'falling'): Promise<Mover[]> {
  const fnName = direction === 'rising' ? 'get_top_risers_filtered' : 'get_top_fallers'
  const { data } = await supabase.rpc(fnName, { time_period: '30d', min_price: 3000 })
  if (!data) return []
  const parsed = typeof data === 'string' ? JSON.parse(data) : data
  const results: any[] = parsed?.results || []
  const filtered = results.filter(r => !isSealed(r.card_name, r.set_name)).slice(0, 10)

  const slugs = filtered.map((r: any) => r.card_slug).filter(Boolean)
  if (!slugs.length) return []
  const { data: imgData } = await supabase.from('cards')
    .select('card_slug,image_url,card_url_slug')
    .in('card_slug', slugs)
  const imgMap: Record<string, any> = {}
  ;(imgData || []).forEach((c: any) => { imgMap[String(c.card_slug)] = c })

  return filtered.map((r: any) => {
    const rawPct = r.pct_30d ?? r.pct_change ?? 0
    return {
      card_slug: r.card_slug,
      card_name: r.card_name,
      set_name: r.set_name,
      card_url_slug: imgMap[r.card_slug]?.card_url_slug ?? null,
      image_url: imgMap[r.card_slug]?.image_url ?? null,
      current_price: r.current_price ?? r.current_raw ?? 0,
      pct_change: direction === 'rising' ? rawPct : -Math.abs(rawPct),
    }
  })
}

async function fetchGradingPick(risers: Mover[]): Promise<GradingPick | null> {
  // For the top 20 risers' cards, look up current_raw + current_psa10 in
  // card_trends and pick whichever has the biggest psa10/raw multiple — that
  // is "the grade play of the week".
  const slugs = risers.map(r => r.card_slug).slice(0, 20)
  if (!slugs.length) return null
  const { data } = await supabase.from('card_trends')
    .select('card_slug,card_name,set_name,current_raw,current_psa10')
    .in('card_slug', slugs)
    .not('current_raw', 'is', null)
    .not('current_psa10', 'is', null)
  if (!data || !data.length) return null

  const moverMap = new Map(risers.map(r => [r.card_slug, r]))
  let best: GradingPick | null = null
  for (const row of data as any[]) {
    if (!row.current_raw || !row.current_psa10) continue
    const mult = row.current_psa10 / row.current_raw
    if (mult < 2.5) continue   // boring grade plays
    if (!best || mult > best.premium_multiple) {
      const m = moverMap.get(row.card_slug)
      best = {
        card_slug:        row.card_slug,
        card_name:        row.card_name,
        set_name:         row.set_name,
        card_url_slug:    m?.card_url_slug ?? null,
        image_url:        m?.image_url ?? null,
        current_raw:      row.current_raw,
        current_psa10:    row.current_psa10,
        premium_multiple: mult,
      }
    }
  }
  return best
}

function deriveMarketInsight(risers: Mover[], fallers: Mover[], trendingSets: TrendingSet[]): string {
  // Pick the single most interesting observation from the data and phrase it
  // for the newsletter. Tiered priority: (1) set concentration in the top
  // risers, (2) avg riser vs avg faller gap, (3) trending sets headline.
  if (risers.length >= 5) {
    const setCounts = new Map<string, number>()
    for (const r of risers.slice(0, 10)) {
      setCounts.set(r.set_name, (setCounts.get(r.set_name) || 0) + 1)
    }
    let topSet = ''
    let topCount = 0
    setCounts.forEach((c, s) => { if (c > topCount) { topSet = s; topCount = c } })
    if (topCount >= 3) {
      return `${topSet} is doing the heavy lifting — ${topCount} of this week's top 10 risers come from that set. Worth a look if you have anything sitting in there.`
    }
  }

  if (risers.length >= 5 && fallers.length >= 5) {
    const avgUp   = risers.slice(0, 5).reduce((a, r) => a + r.pct_change, 0) / 5
    const avgDown = fallers.slice(0, 5).reduce((a, r) => a + r.pct_change, 0) / 5
    if (avgUp >= 15 && Math.abs(avgDown) < avgUp / 2) {
      return `Risers were running hotter than fallers this week — the top 5 averaged +${avgUp.toFixed(1)}% while the bottom 5 only gave back ${avgDown.toFixed(1)}%. Net positive market.`
    }
    if (Math.abs(avgDown) > avgUp) {
      return `Sharper red than green this week — the top 5 risers averaged +${avgUp.toFixed(1)}% but the worst 5 dropped ${avgDown.toFixed(1)}%. Cooling pattern worth watching.`
    }
  }

  if (trendingSets.length > 0) {
    const top = trendingSets[0]
    return `${top.set_name} is the set to watch — average single price up ${top.avg_pct_30d.toFixed(1)}% over 30 days across ${top.card_count} cards tracked.`
  }

  return `Mixed week across the board. No single set or grade tier dominated the moves — usually a sign the market is digesting recent releases.`
}

async function generateNewsletter(): Promise<NewsletterData> {
  const [marketTotalRes, marketIndexRes, risers, fallers, gemsRes, trendingSetsRes] = await Promise.all([
    supabase.rpc('get_market_total'),
    supabase.from('market_index')
      .select('date,total_raw_usd,raw_pct_30d')
      .order('date', { ascending: false })
      .limit(1),
    fetchMovers('rising'),
    fetchMovers('falling'),
    supabase.rpc('get_hidden_gems', { lim: 6 }),
    supabase.rpc('get_trending_sets', { lim: 5 }),
  ])

  const total = (marketTotalRes.data as any) || {}
  const latestIdx = (marketIndexRes.data && marketIndexRes.data[0]) as any
  const totalMarketUsd = total.total_raw_usd ?? latestIdx?.total_raw_usd ?? 0
  const cardsTracked   = total.cards_tracked ?? 0
  const pct30d         = latestIdx?.raw_pct_30d != null ? Number(latestIdx.raw_pct_30d) : null

  // Hydrate hidden gem images
  let hiddenGem: HiddenGem | null = null
  const gems = (gemsRes.data || []) as HiddenGem[]
  if (gems.length > 0) {
    const top = gems[0]
    const { data: imgData } = await supabase.from('cards')
      .select('card_slug,image_url,card_url_slug')
      .eq('card_slug', top.card_slug)
      .maybeSingle()
    hiddenGem = {
      ...top,
      image_url:     (imgData as any)?.image_url ?? null,
      card_url_slug: (imgData as any)?.card_url_slug ?? top.card_url_slug,
    }
  }

  const gradingPick = await fetchGradingPick(risers)
  const tsData = (trendingSetsRes.data as any) || {}
  const trendingSets: TrendingSet[] = (tsData.rising ?? []) as TrendingSet[]

  const marketInsight = deriveMarketInsight(risers, fallers, trendingSets)

  return {
    generatedAt: new Date(),
    totalMarketUsd,
    cardsTracked,
    pct30d,
    risers,
    fallers,
    hiddenGem,
    gradingPick,
    trendingSets: trendingSets.slice(0, 5),
    marketInsight,
  }
}

// ── Section builders (return both markdown and HTML) ─────────────────────

function buildIntro(d: NewsletterData) {
  const direction = (d.pct30d ?? 0) >= 0 ? 'up' : 'down'
  const pctTxt = d.pct30d != null ? `${direction} ${Math.abs(d.pct30d).toFixed(1)}%` : 'roughly flat'
  const total = fmtUsdCents(d.totalMarketUsd)
  const cardsTxt = d.cardsTracked ? ` across ${d.cardsTracked.toLocaleString('en-US')} cards tracked` : ''
  const text = `This week the Pokémon TCG market we track sits at ${total}${cardsTxt}, ${pctTxt} over the last 30 days. Here are the biggest moves, one market signal worth chewing on, and a couple of cards we are quietly watching.`
  return { md: text, html: `<p>${text}</p>`, text }
}

function buildBiggestMovers(d: NewsletterData) {
  const mdLines: string[] = []
  const htmlLines: string[] = []
  const txtLines: string[] = []

  const renderGroup = (title: string, rows: Mover[], emoji: string) => {
    mdLines.push(`### ${emoji} ${title}\n`)
    htmlLines.push(`<h3>${emoji} ${title}</h3><ul>`)
    txtLines.push(`${title.toUpperCase()}`)
    rows.slice(0, 5).forEach(r => {
      const url = cardUrl(r.set_name, r.card_url_slug, r.card_slug)
      const sign = r.pct_change >= 0 ? '+' : ''
      const line = `${r.card_name} (${r.set_name}) · ${fmtPrice(r.current_price)} raw · ${sign}${r.pct_change.toFixed(1)}%`
      mdLines.push(`- [${r.card_name}](${url}) — ${r.set_name} · ${fmtPrice(r.current_price)} raw · ${sign}${r.pct_change.toFixed(1)}%`)
      htmlLines.push(`<li><a href="${url}">${r.card_name}</a> — ${r.set_name} · <strong>${fmtPrice(r.current_price)} raw</strong> · ${sign}${r.pct_change.toFixed(1)}%</li>`)
      txtLines.push(`  ${line}`)
    })
    htmlLines.push('</ul>')
    mdLines.push('')
    txtLines.push('')
  }
  renderGroup('Top Risers (30d)',  d.risers,  '📈')
  renderGroup('Top Fallers (30d)', d.fallers, '📉')

  return { md: mdLines.join('\n').trim(), html: htmlLines.join(''), text: txtLines.join('\n').trim() }
}

function buildMarketInsight(d: NewsletterData) {
  return {
    md:   d.marketInsight,
    html: `<p>${d.marketInsight}</p>`,
    text: d.marketInsight,
  }
}

function buildGradingWatch(d: NewsletterData) {
  if (!d.gradingPick) {
    const fallback = 'No standout grade-premium plays this week — PSA 10 multiples sat close to their usual ranges. Worth waiting for the next bump.'
    return { md: fallback, html: `<p>${fallback}</p>`, text: fallback }
  }
  const p = d.gradingPick
  const url = cardUrl(p.set_name, p.card_url_slug, p.card_slug)
  const mult = p.premium_multiple.toFixed(1)
  const text = `${p.card_name} from ${p.set_name} caught our eye. Raw sits at ${fmtPrice(p.current_raw)} while PSA 10 copies are trading around ${fmtPrice(p.current_psa10)} — about ${mult}× the raw price. After grading fees, the maths only works if you can hit a clean 10, but the spread is wide enough that it is on the radar.`
  return {
    md:   `[${p.card_name}](${url}) (${p.set_name}) caught our eye. Raw sits at **${fmtPrice(p.current_raw)}** while PSA 10 copies are trading around **${fmtPrice(p.current_psa10)}** — about **${mult}× the raw price**. After grading fees, the maths only works if you can hit a clean 10, but the spread is wide enough that it is on the radar.`,
    html: `<p><a href="${url}"><strong>${p.card_name}</strong></a> (${p.set_name}) caught our eye. Raw sits at <strong>${fmtPrice(p.current_raw)}</strong> while PSA 10 copies are trading around <strong>${fmtPrice(p.current_psa10)}</strong> — about <strong>${mult}× the raw price</strong>. After grading fees, the maths only works if you can hit a clean 10, but the spread is wide enough that it is on the radar.</p>`,
    text,
  }
}

function buildCollectorFocus(d: NewsletterData) {
  if (!d.hiddenGem) {
    const fallback = 'Nothing flagged in the hidden-gems pipeline this week.'
    return { md: fallback, html: `<p>${fallback}</p>`, text: fallback }
  }
  const g = d.hiddenGem
  const url = cardUrl(g.set_name, g.card_url_slug, g.card_slug)
  const pctTxt = g.pct_30d != null ? `up ${g.pct_30d.toFixed(1)}% over 30 days` : 'showing steady volume'
  const popTxt = g.psa10_pop > 0 ? `, PSA 10 population sits at just ${g.psa10_pop}` : ''
  const text = `${g.card_name} (${g.set_name}) — currently around ${fmtPrice(g.current_price)} raw and ${pctTxt}${popTxt}. Quiet rise, small pop — the kind of card that gets noticed once someone writes a thread.`
  return {
    md:   `[${g.card_name}](${url}) (${g.set_name}) — currently around **${fmtPrice(g.current_price)}** raw and ${pctTxt}${popTxt}. Quiet rise, small pop — the kind of card that gets noticed once someone writes a thread.`,
    html: `<p><a href="${url}"><strong>${g.card_name}</strong></a> (${g.set_name}) — currently around <strong>${fmtPrice(g.current_price)}</strong> raw and ${pctTxt}${popTxt}. Quiet rise, small pop — the kind of card that gets noticed once someone writes a thread.</p>`,
    text,
  }
}

function buildTrendingSearches(d: NewsletterData) {
  // We do not track individual searches; the next-best proxy is "sets
  // collectors are putting volume into" — get_trending_sets is computed from
  // average 30d movement across each set.
  if (!d.trendingSets.length) {
    const fallback = 'Nothing surfaced as obviously trending this week.'
    return { md: fallback, html: `<p>${fallback}</p>`, text: fallback }
  }
  const mdLines = ['What collectors are circling around right now (by 30-day set momentum):', '']
  const htmlLines = ['<p>What collectors are circling around right now (by 30-day set momentum):</p><ol>']
  const txtLines = ['What collectors are circling around right now (by 30-day set momentum):', '']
  d.trendingSets.forEach((s, i) => {
    const url = setUrl(s.set_name)
    const line = `${s.set_name} — avg single +${s.avg_pct_30d.toFixed(1)}% / ${s.card_count} cards`
    mdLines.push(`${i + 1}. [${s.set_name}](${url}) — avg single **+${s.avg_pct_30d.toFixed(1)}%** / ${s.card_count} cards`)
    htmlLines.push(`<li><a href="${url}">${s.set_name}</a> — avg single <strong>+${s.avg_pct_30d.toFixed(1)}%</strong> / ${s.card_count} cards</li>`)
    txtLines.push(`  ${i + 1}. ${line}`)
  })
  htmlLines.push('</ol>')
  return { md: mdLines.join('\n').trim(), html: htmlLines.join(''), text: txtLines.join('\n').trim() }
}

function buildClosing() {
  const text = 'More live pricing and market tools at PokePrices.io'
  return {
    md:   `_${text}_`,
    html: `<p><em>${text}</em></p>`,
    text,
  }
}

// ── Component ─────────────────────────────────────────────────────────────

type SectionId = 'intro' | 'movers' | 'insight' | 'grading' | 'focus' | 'trending' | 'closing'
type Section = { id: SectionId; title: string; md: string; html: string; text: string }

// ── AI rewrite ────────────────────────────────────────────────────────────

const REWRITE_INSTRUCTIONS: Partial<Record<SectionId, string>> = {
  intro:   'Rewrite this weekly newsletter intro. Keep it 2-3 short sentences, conversational collector-to-collector tone, no marketing speak. Preserve every number and percentage exactly as-is.',
  insight: 'Rewrite this market insight observation. Keep it to one short paragraph, collector-to-collector tone, plain language. Preserve every number, percentage, and set name exactly.',
  grading: 'Rewrite this grading-watch paragraph. One paragraph, plain prose, honest about the maths. Preserve every card name, set name, dollar figure, and the multiplier exactly.',
  focus:   'Rewrite this collector-focus paragraph. One paragraph, intriguing but not hype-y. Preserve every card name, set name, dollar figure, and percentage exactly.',
}

async function rewriteWithAI(sectionId: SectionId, currentText: string): Promise<string> {
  const instr = REWRITE_INSTRUCTIONS[sectionId]
  if (!instr) throw new Error('This section is not AI-rewriteable.')
  const message = `${instr}\n\nReturn ONLY the rewritten text, nothing else. No preamble. No quotes around the result.\n\nORIGINAL:\n${currentText}`
  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
    body: JSON.stringify({
      message,
      session_id: 'newsletter-rewrite-' + Math.random().toString(36).slice(2, 8),
      history: [],
    }),
  })
  if (!res.ok) throw new Error(`AI rewrite failed: HTTP ${res.status}`)
  const json = await res.json()
  const answer = (json?.answer || json?.response || '').toString().trim()
  if (!answer) throw new Error('AI returned an empty rewrite.')
  // Strip wrapping quotes if the model added them
  return answer.replace(/^["“'']\s*|\s*["”'']$/g, '').trim()
}

// ── Image generation ─────────────────────────────────────────────────────

type ImageKey = 'intro' | 'movers-risers' | 'movers-fallers' | 'insight' | 'grading' | 'focus' | 'trending'

async function renderImage(template: 'intro' | 'movers' | 'fallers' | 'insight' | 'grading' | 'focus' | 'trending', payload: any, weekLabel: string): Promise<string> {
  const res = await fetch('/api/newsletter/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template, payload, weekLabel }),
  })
  if (!res.ok) {
    let detail = ''
    try { const j = await res.json(); detail = j?.error || '' } catch {}
    throw new Error(`Render failed: HTTP ${res.status} ${detail}`)
  }
  const blob = await res.blob()
  if (blob.size === 0) throw new Error('Render returned an empty image.')
  return URL.createObjectURL(blob)
}

function downloadBlobUrl(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ── Component ─────────────────────────────────────────────────────────────

export default function NewsletterStudioClient() {
  const [authed, setAuthed]   = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [data, setData]       = useState<NewsletterData | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  // Per-section markdown overrides (set when user clicks "Rewrite with AI")
  const [overrides, setOverrides] = useState<Partial<Record<SectionId, string>>>({})
  const [rewriting, setRewriting] = useState<SectionId | null>(null)
  // Generated image blob URLs, keyed by section + variant
  const [images, setImages] = useState<Partial<Record<ImageKey, string>>>({})
  const [rendering, setRendering] = useState<ImageKey | null>(null)

  useEffect(() => {
    try { setAuthed(sessionStorage.getItem(SESSION_KEY) === '1') } catch { setAuthed(false) }
  }, [])

  // Revoke object URLs on unmount / regenerate
  useEffect(() => () => {
    Object.values(images).forEach(u => { if (u) URL.revokeObjectURL(u) })
  }, [images])

  async function generate() {
    setLoading(true)
    setError(null)
    // Clear previous overrides/images on fresh generate
    setOverrides({})
    Object.values(images).forEach(u => { if (u) URL.revokeObjectURL(u) })
    setImages({})
    try {
      const d = await generateNewsletter()
      setData(d)
    } catch (e: any) {
      setError(e?.message || 'Generation failed.')
    } finally {
      setLoading(false)
    }
  }

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1400)
    } catch {
      setError('Clipboard failed. Select the text manually.')
    }
  }

  async function handleRewrite(sectionId: SectionId, currentMd: string) {
    setRewriting(sectionId)
    setError(null)
    try {
      const rewritten = await rewriteWithAI(sectionId, currentMd)
      setOverrides(prev => ({ ...prev, [sectionId]: rewritten }))
    } catch (e: any) {
      setError(e?.message || 'AI rewrite failed.')
    } finally {
      setRewriting(null)
    }
  }

  async function handleRenderImage(key: ImageKey, template: any, payload: any) {
    if (!data) return
    setRendering(key)
    setError(null)
    try {
      const weekLabel = `Week of ${thisWeekLabel(data.generatedAt)}`
      const url = await renderImage(template, payload, weekLabel)
      // Free previous URL if any
      const prev = images[key]
      if (prev) URL.revokeObjectURL(prev)
      setImages(curr => ({ ...curr, [key]: url }))
    } catch (e: any) {
      setError(e?.message || 'Image render failed.')
    } finally {
      setRendering(null)
    }
  }

  if (authed === null) return null
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />

  // Build sections, then layer overrides on top of the markdown
  const baseSections: Section[] = data ? [
    { id: 'intro',    title: 'Intro',              ...buildIntro(data) },
    { id: 'movers',   title: 'Biggest Movers',     ...buildBiggestMovers(data) },
    { id: 'insight',  title: 'Market Insight',     ...buildMarketInsight(data) },
    { id: 'grading',  title: 'Grading Watch',      ...buildGradingWatch(data) },
    { id: 'focus',    title: 'Collector Focus',    ...buildCollectorFocus(data) },
    { id: 'trending', title: 'Trending Searches',  ...buildTrendingSearches(data) },
    { id: 'closing',  title: 'Closing',            ...buildClosing() },
  ] : []
  const sections: Section[] = baseSections.map(s => {
    const o = overrides[s.id]
    if (!o) return s
    return {
      ...s,
      md: o,
      html: `<p>${o.replace(/\n/g, '<br/>')}</p>`,
      text: o,
    }
  })

  const allMd   = sections.map(s => `## ${s.title}\n\n${s.md}`).join('\n\n')
  const allHtml = sections.map(s => `<h2>${s.title}</h2>${s.html}`).join('')
  const allTxt  = sections.map(s => `${s.title.toUpperCase()}\n${'-'.repeat(s.title.length)}\n${s.text}`).join('\n\n')

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 16px 60px', fontFamily: "'Figtree', sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, margin: '0 0 4px', color: 'var(--text)' }}>Newsletter Studio</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6, maxWidth: 720 }}>
            One-click weekly newsletter content pack. Generates intro, biggest movers, market insight, grading watch, collector focus, trending sets, and a closing line — all from live PokePrices data. Copy per section or grab the whole thing as Markdown / HTML / plain text and paste into your newsletter tool.
          </p>
        </div>
        <button onClick={generate} disabled={loading}
          style={{
            padding: '11px 18px', borderRadius: 10, border: 'none',
            background: 'var(--primary)', color: '#fff',
            fontSize: 14, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1, whiteSpace: 'nowrap', flexShrink: 0,
          }}>
          {loading ? 'Generating…' : data ? '↻ Regenerate' : '⚡ Generate this week\'s newsletter'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {!data && !loading && (
        <div style={{ marginTop: 18, padding: '32px 24px', borderRadius: 14, border: '1px dashed var(--border)', background: 'var(--bg-light)', textAlign: 'center' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>📬</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            Hit <strong>Generate</strong> to pull this week's data and build the newsletter sections.
          </p>
        </div>
      )}

      {data && (
        <>
          {/* Generated-at strip */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14, letterSpacing: 0.5 }}>
            Generated {thisWeekLabel(data.generatedAt)} · all numbers live as of generation
          </div>

          {/* Section cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
            {sections.map(s => (
              <SectionCard
                key={s.id}
                section={s}
                data={data}
                copied={copiedKey === s.id}
                rewriting={rewriting === s.id}
                rendering={rendering}
                images={images}
                onCopy={() => copy(s.id, s.md)}
                onRewrite={() => handleRewrite(s.id, s.md)}
                onRenderImage={handleRenderImage}
              />
            ))}
          </div>

          {/* Card thumbnails strip — only Risers + Hidden Gem + Grading pick */}
          <ImagesPanel data={data} />

          {/* Whole-newsletter copy actions */}
          <div style={{
            marginTop: 28, padding: 18, background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Copy the whole newsletter</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Markdown is great for Substack / Buttondown / ConvertKit. HTML for Mailchimp-style block editors. Plain text for sanity-check.
              </div>
            </div>
            <CopyButton label={copiedKey === 'all-md' ? 'Copied ✓' : 'Markdown'} onClick={() => copy('all-md', allMd)} />
            <CopyButton label={copiedKey === 'all-html' ? 'Copied ✓' : 'HTML'} onClick={() => copy('all-html', allHtml)} />
            <CopyButton label={copiedKey === 'all-txt' ? 'Copied ✓' : 'Plain text'} onClick={() => copy('all-txt', allTxt)} />
          </div>
        </>
      )}
    </div>
  )
}

function SectionCard({ section, data, copied, rewriting, rendering, images, onCopy, onRewrite, onRenderImage }: {
  section: Section
  data: NewsletterData
  copied: boolean
  rewriting: boolean
  rendering: ImageKey | null
  images: Partial<Record<ImageKey, string>>
  onCopy: () => void
  onRewrite: () => void
  onRenderImage: (key: ImageKey, template: any, payload: any) => void
}) {
  const canRewrite = !!REWRITE_INSTRUCTIONS[section.id]

  // Build the image button(s) for this section
  const imageButtons: { key: ImageKey; label: string; template: string; payload: any }[] = []
  if (section.id === 'intro') {
    imageButtons.push({
      key: 'intro', label: 'Intro graphic', template: 'intro',
      payload: { totalMarketUsd: data.totalMarketUsd, cardsTracked: data.cardsTracked, pct30d: data.pct30d },
    })
  } else if (section.id === 'movers') {
    if (data.risers.length > 0) {
      imageButtons.push({
        key: 'movers-risers', label: 'Risers graphic', template: 'movers',
        payload: { items: data.risers.slice(0, 5) },
      })
    }
    if (data.fallers.length > 0) {
      imageButtons.push({
        key: 'movers-fallers', label: 'Fallers graphic', template: 'fallers',
        payload: { items: data.fallers.slice(0, 5) },
      })
    }
  } else if (section.id === 'insight') {
    imageButtons.push({
      key: 'insight', label: 'Insight graphic', template: 'insight',
      payload: { text: section.md },
    })
  } else if (section.id === 'grading' && data.gradingPick) {
    imageButtons.push({
      key: 'grading', label: 'Grading graphic', template: 'grading',
      payload: { card: data.gradingPick },
    })
  } else if (section.id === 'focus' && data.hiddenGem) {
    imageButtons.push({
      key: 'focus', label: 'Focus graphic', template: 'focus',
      payload: {
        card: {
          card_name: data.hiddenGem.card_name,
          set_name: data.hiddenGem.set_name,
          current_price: data.hiddenGem.current_price,
          pct_30d: data.hiddenGem.pct_30d,
          psa10_pop: data.hiddenGem.psa10_pop,
          image_url: data.hiddenGem.image_url,
        },
      },
    })
  } else if (section.id === 'trending' && data.trendingSets.length > 0) {
    imageButtons.push({
      key: 'trending', label: 'Trending graphic', template: 'trending',
      payload: { sets: data.trendingSets },
    })
  }
  // 'closing' has no image button

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '16px 18px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, margin: 0, color: 'var(--text)' }}>
          {section.title}
        </h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {imageButtons.map(b => (
            <CopyButton
              key={b.key}
              label={rendering === b.key ? 'Rendering…' : `🖼  ${b.label}`}
              onClick={() => onRenderImage(b.key, b.template, b.payload)}
            />
          ))}
          {canRewrite && (
            <CopyButton
              label={rewriting ? 'Rewriting…' : '✨ Rewrite with AI'}
              onClick={onRewrite}
            />
          )}
          <CopyButton label={copied ? 'Copied ✓' : 'Copy markdown'} onClick={onCopy} />
        </div>
      </div>

      <pre style={{
        margin: 0, padding: '12px 14px',
        background: 'var(--bg-light)', borderRadius: 10, border: '1px solid var(--border)',
        whiteSpace: 'pre-wrap', wordWrap: 'break-word',
        fontSize: 13, color: 'var(--text)', lineHeight: 1.65,
        fontFamily: "'Figtree', sans-serif",
        overflow: 'auto', maxHeight: 320,
      }}>{section.md}</pre>

      {/* Render generated images for this section */}
      {imageButtons.some(b => images[b.key]) && (
        <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {imageButtons.map(b => images[b.key] ? (
            <ImagePreview
              key={b.key}
              src={images[b.key]!}
              filename={`pokeprices-newsletter-${section.id}-${b.key}.png`}
              label={b.label}
            />
          ) : null)}
        </div>
      )}
    </div>
  )
}

function ImagePreview({ src, filename, label }: { src: string; filename: string; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <img src={src} alt={label} style={{
        width: '100%', height: 'auto', borderRadius: 8, border: '1px solid var(--border)',
        display: 'block',
      }} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
        <button onClick={() => downloadBlobUrl(src, filename)}
          style={{
            padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800,
            background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer',
            fontFamily: "'Figtree', sans-serif",
          }}>
          Download PNG
        </button>
      </div>
    </div>
  )
}

function CopyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 8,
      border: '1px solid var(--border)', background: 'var(--bg-light)',
      color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
      fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap',
    }}>
      {label}
    </button>
  )
}

function ImagesPanel({ data }: { data: NewsletterData }) {
  const cards: { label: string; img: string | null; href: string; title: string }[] = []
  data.risers.slice(0, 5).forEach((r, i) => cards.push({
    label: `Riser #${i + 1}`,
    img: r.image_url,
    href: cardUrl(r.set_name, r.card_url_slug, r.card_slug),
    title: r.card_name,
  }))
  if (data.gradingPick) cards.push({
    label: 'Grading Watch',
    img: data.gradingPick.image_url,
    href: cardUrl(data.gradingPick.set_name, data.gradingPick.card_url_slug, data.gradingPick.card_slug),
    title: data.gradingPick.card_name,
  })
  if (data.hiddenGem) cards.push({
    label: 'Collector Focus',
    img: data.hiddenGem.image_url ?? null,
    href: cardUrl(data.hiddenGem.set_name, data.hiddenGem.card_url_slug, data.hiddenGem.card_slug),
    title: data.hiddenGem.card_name,
  })

  if (!cards.length) return null

  return (
    <div style={{
      marginTop: 4, padding: 18, background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 14,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Card images for the newsletter</div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        Right-click → "Copy image address" to paste into your newsletter tool, or click through to the card page if you want a screenshot of the live chart.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
        {cards.map((c, i) => (
          <a key={i} href={c.href} target="_blank" rel="noopener noreferrer"
            style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
          >
            {c.img ? (
              <img src={c.img} alt={c.title} style={{ width: '100%', maxWidth: 110, height: 'auto', borderRadius: 4, border: '1px solid var(--border)' }} />
            ) : (
              <div style={{ width: '100%', maxWidth: 110, aspectRatio: '3/4', borderRadius: 4, background: 'var(--bg-light)', border: '1px solid var(--border)' }} />
            )}
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--primary)' }}>
              {c.label}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {c.title}
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
