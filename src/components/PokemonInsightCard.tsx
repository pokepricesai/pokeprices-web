// PokemonInsightCard — 1080×1080 shareable "dossier" for a Pokémon species.
// Rendered off-screen in PokemonSpeciesPageClient and captured to PNG via pngExport.

interface CardData {
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  raw_usd: number | null
  psa10_usd: number | null
}

interface Props {
  pokeData: any
  speciesData: any
  displayName: string
  cards: CardData[]
  uniqueSetCount: number
  mostExpensiveRaw: CardData | null
  mostExpensivePsa10: CardData | null
}

// Type-color palette: vibrant top → darker mid → near-black bottom for depth.
// "text" is the foreground colour for elements that sit on the bg directly.
const TYPE_COLORS: Record<string, { bg: string; bg2: string; text: string }> = {
  fire:     { bg: '#FF6B35', bg2: '#C72D14', text: '#fff' },
  water:    { bg: '#4A90D9', bg2: '#1D5494', text: '#fff' },
  grass:    { bg: '#56C271', bg2: '#1F8A3E', text: '#fff' },
  electric: { bg: '#F5C518', bg2: '#B8901A', text: '#1a1a1a' },
  psychic:  { bg: '#E8538F', bg2: '#A82565', text: '#fff' },
  ice:      { bg: '#74CEC0', bg2: '#3F8C82', text: '#1a1a1a' },
  dragon:   { bg: '#6B5FA6', bg2: '#3B315F', text: '#fff' },
  dark:     { bg: '#5C4A3B', bg2: '#2B1F16', text: '#fff' },
  fairy:    { bg: '#F4A7C3', bg2: '#C16591', text: '#1a1a1a' },
  fighting: { bg: '#C03028', bg2: '#7A1610', text: '#fff' },
  poison:   { bg: '#9B59B6', bg2: '#5C2D77', text: '#fff' },
  ground:   { bg: '#C49A3C', bg2: '#7A5A14', text: '#fff' },
  rock:     { bg: '#B8A038', bg2: '#7A6920', text: '#fff' },
  bug:      { bg: '#8CB820', bg2: '#5A7510', text: '#fff' },
  ghost:    { bg: '#5B4F8A', bg2: '#312957', text: '#fff' },
  steel:    { bg: '#9EB8D0', bg2: '#5A7A98', text: '#1a1a1a' },
  normal:   { bg: '#A8A878', bg2: '#6E6E47', text: '#fff' },
  flying:   { bg: '#8EC8F0', bg2: '#4F8AB8', text: '#1a1a1a' },
}

const STAT_LABEL: Record<string, string> = {
  hp: 'HP', attack: 'ATK', defense: 'DEF',
  'special-attack': 'Sp.ATK', 'special-defense': 'Sp.DEF', speed: 'SPD',
}

function fmtPrice(cents: number | null | undefined): string {
  if (!cents) return '—'
  const v = cents / 100
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1000)      return `$${(v / 1000).toFixed(1)}k`
  if (v >= 100)       return `$${v.toFixed(0)}`
  return `$${v.toFixed(2)}`
}

function proxyImg(url: string | null): string | null {
  if (!url) return null
  return `/api/imgproxy?url=${encodeURIComponent(url)}`
}

export default function PokemonInsightCard({
  pokeData,
  speciesData,
  displayName,
  cards,
  uniqueSetCount,
  mostExpensiveRaw,
  mostExpensivePsa10,
}: Props) {
  if (!pokeData) return null

  const types: string[] = pokeData.types.map((t: any) => t.type.name)
  const primaryType = types[0]
  const tc = TYPE_COLORS[primaryType] ?? { bg: '#3b8fe8', bg2: '#1a5fad', text: '#fff' }
  const stats = pokeData.stats.map((s: any) => ({ name: s.stat.name, value: s.base_stat }))
  const dexNumber = String(pokeData.id).padStart(3, '0')
  const artworkUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeData.id}.png`
  const isLegendary = !!speciesData?.is_legendary
  const isMythical  = !!speciesData?.is_mythical
  const genus = speciesData?.genera?.find((g: any) => g.language.name === 'en')?.genus

  const featured = mostExpensivePsa10?.psa10_usd ? mostExpensivePsa10 : mostExpensiveRaw
  const featuredPrice = featured?.psa10_usd ?? featured?.raw_usd ?? null
  const featuredGrade = featured?.psa10_usd ? 'PSA 10' : 'Raw'

  const headerStat = featured ? fmtPrice(featuredPrice) : '—'
  const headerStatLabel = featured ? `Max ${featuredGrade}` : 'Max value'

  // Layout uses absolute positioning for header/footer so flex column for the
  // rest can flow naturally without precise pixel maths.
  return (
    <div
      id="pokemon-insight-card"
      style={{
        width: 1080,
        height: 1080,
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        background: `linear-gradient(165deg, ${tc.bg} 0%, ${tc.bg2} 55%, #0f0f1a 100%)`,
        color: tc.text,
        fontFamily: "'Figtree', sans-serif",
      }}
    >
      {/* Decorative type-colored radial accent */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -200, right: -160,
          width: 600, height: 600,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${tc.bg}aa, transparent 70%)`,
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      {/* HEADER */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '32px 44px', zIndex: 2,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 4, textTransform: 'uppercase', opacity: 0.85 }}>
            Pokémon Dossier
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.65, marginTop: 2 }}>#{dexNumber}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid rgba(255,255,255,0.4)',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: tc.text }} />
          </div>
          <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: 1.5, fontFamily: "'Outfit', sans-serif" }}>
            POKEPRICES.IO
          </span>
        </div>
      </div>

      {/* HERO: artwork + name + types */}
      <div style={{
        position: 'absolute', top: 96, left: 0, right: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '0 40px',
      }}>
        <img
          src={artworkUrl}
          alt={displayName}
          style={{
            width: 320, height: 320, objectFit: 'contain',
            filter: 'drop-shadow(0 16px 36px rgba(0,0,0,0.45))',
            display: 'block',
          }}
        />
        <h1 style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: 64, fontWeight: 900, letterSpacing: -1.5,
          margin: '4px 0 4px', textTransform: 'capitalize',
          textShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          {displayName}
        </h1>
        {genus && (
          <p style={{ fontSize: 16, fontStyle: 'italic', opacity: 0.85, margin: '0 0 12px' }}>
            The {genus}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {types.map((t: string) => (
            <span key={t} style={{
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.25)',
              padding: '6px 16px', borderRadius: 24,
              fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.4,
            }}>
              {t}
            </span>
          ))}
          {isLegendary && (
            <span style={{
              background: '#FFD166', color: '#1a1a1a',
              padding: '6px 16px', borderRadius: 24,
              fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1.4,
            }}>
              Legendary
            </span>
          )}
          {isMythical && (
            <span style={{
              background: '#C77DFF', color: '#fff',
              padding: '6px 16px', borderRadius: 24,
              fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1.4,
            }}>
              Mythical
            </span>
          )}
        </div>
      </div>

      {/* COLLECTOR STATS (3 column) */}
      <div style={{
        position: 'absolute', top: 600, left: 40, right: 40,
        background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 18,
        padding: '20px 28px',
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
      }}>
        <Stat big={String(cards.length)}     small="Cards Tracked" />
        <Stat big={String(uniqueSetCount)}   small="Sets Featured" />
        <Stat big={headerStat}               small={headerStatLabel} />
      </div>

      {/* BATTLE STATS */}
      <div style={{
        position: 'absolute', top: 740, left: 40, right: 40,
        padding: '0 4px',
      }}>
        <div style={{
          fontSize: 12, fontWeight: 900, letterSpacing: 3,
          opacity: 0.85, marginBottom: 10, textTransform: 'uppercase',
        }}>
          Battle Stats · {stats.reduce((s: number, st: any) => s + st.value, 0)} total
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28, rowGap: 8,
        }}>
          {stats.map((s: any) => (
            <StatBar key={s.name} name={STAT_LABEL[s.name] ?? s.name} value={s.value} accent={tc.bg} />
          ))}
        </div>
      </div>

      {/* FEATURED CARD + FOOTER */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'rgba(0,0,0,0.55)',
        borderTop: '1px solid rgba(255,255,255,0.18)',
        padding: '18px 40px',
      }}>
        {featured ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {featured.image_url && (
              <img
                crossOrigin="anonymous"
                src={proxyImg(featured.image_url) || ''}
                alt={featured.card_name}
                style={{
                  width: 70, height: 98, objectFit: 'contain', borderRadius: 6,
                  flexShrink: 0, background: 'rgba(255,255,255,0.04)',
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2, opacity: 0.7, textTransform: 'uppercase' }}>
                Most Valuable Card
              </div>
              <div style={{ fontSize: 19, fontWeight: 900, marginTop: 2, fontFamily: "'Outfit', sans-serif" }}>
                {featured.card_name}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>
                {featured.set_name}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 900, fontFamily: "'Outfit', sans-serif" }}>
                {fmtPrice(featuredPrice)}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2 }}>
                {featuredGrade}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontSize: 13, opacity: 0.7, padding: '14px 0' }}>
            No card price data yet.
          </div>
        )}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 11, opacity: 0.6, marginTop: 10, fontWeight: 700, letterSpacing: 1,
        }}>
          <span>pokeprices.io</span>
          <span>Live prices · Updated daily</span>
        </div>
      </div>
    </div>
  )
}

function Stat({ big, small }: { big: string; small: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: 38, fontWeight: 900, lineHeight: 1,
        fontFamily: "'Outfit', sans-serif", letterSpacing: -0.5,
      }}>
        {big}
      </div>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: 1.8,
        opacity: 0.75, marginTop: 6, textTransform: 'uppercase',
      }}>
        {small}
      </div>
    </div>
  )
}

function StatBar({ name, value, accent }: { name: string; value: number; accent: string }) {
  const pct = Math.min(100, (value / 200) * 100) // 200 is a comfortable visual cap
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '60px 38px 1fr', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 800, opacity: 0.85, letterSpacing: 1, textTransform: 'uppercase' }}>{name}</span>
      <span style={{ fontSize: 16, fontWeight: 900, fontFamily: "'Outfit', sans-serif", textAlign: 'right' }}>{value}</span>
      <div style={{ height: 8, background: 'rgba(0,0,0,0.35)', borderRadius: 99, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: `linear-gradient(90deg, ${accent} 0%, #ffffff90 100%)`,
          borderRadius: 99, transition: 'width 0.3s',
        }} />
      </div>
    </div>
  )
}
