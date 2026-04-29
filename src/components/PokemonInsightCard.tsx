// PokemonInsightCard — 1080×1080 shareable "Collector's Dossier".
// Layout uses CSS grid with explicit row heights so html-to-image cannot
// collapse or overlap sections, and 3-column hero with type chips on the
// left, artwork centred, and Pokédex info (HT/WT/ABILITY) on the right.

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

const TYPE_COLORS: Record<string, { bg: string; bg2: string; text: string; accent: string }> = {
  fire:     { bg: '#FF6B35', bg2: '#C72D14', text: '#fff',     accent: '#FFD166' },
  water:    { bg: '#4A90D9', bg2: '#1D5494', text: '#fff',     accent: '#74CEC0' },
  grass:    { bg: '#56C271', bg2: '#1F8A3E', text: '#fff',     accent: '#FFD166' },
  electric: { bg: '#F5C518', bg2: '#B8901A', text: '#1a1a1a',  accent: '#fff'    },
  psychic:  { bg: '#E8538F', bg2: '#A82565', text: '#fff',     accent: '#FFD166' },
  ice:      { bg: '#74CEC0', bg2: '#3F8C82', text: '#1a1a1a',  accent: '#fff'    },
  dragon:   { bg: '#6B5FA6', bg2: '#3B315F', text: '#fff',     accent: '#FFD166' },
  dark:     { bg: '#5C4A3B', bg2: '#2B1F16', text: '#fff',     accent: '#FFD166' },
  fairy:    { bg: '#F4A7C3', bg2: '#C16591', text: '#1a1a1a',  accent: '#fff'    },
  fighting: { bg: '#C03028', bg2: '#7A1610', text: '#fff',     accent: '#FFD166' },
  poison:   { bg: '#9B59B6', bg2: '#5C2D77', text: '#fff',     accent: '#FFD166' },
  ground:   { bg: '#C49A3C', bg2: '#7A5A14', text: '#fff',     accent: '#FFD166' },
  rock:     { bg: '#B8A038', bg2: '#7A6920', text: '#fff',     accent: '#FFD166' },
  bug:      { bg: '#8CB820', bg2: '#5A7510', text: '#fff',     accent: '#FFD166' },
  ghost:    { bg: '#5B4F8A', bg2: '#312957', text: '#fff',     accent: '#FFD166' },
  steel:    { bg: '#9EB8D0', bg2: '#5A7A98', text: '#1a1a1a',  accent: '#fff'    },
  normal:   { bg: '#A8A878', bg2: '#6E6E47', text: '#fff',     accent: '#FFD166' },
  flying:   { bg: '#8EC8F0', bg2: '#4F8AB8', text: '#1a1a1a',  accent: '#fff'    },
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
  const tc = TYPE_COLORS[primaryType] ?? { bg: '#3b8fe8', bg2: '#1a5fad', text: '#fff', accent: '#FFD166' }
  const stats = pokeData.stats.map((s: any) => ({ name: s.stat.name, value: s.base_stat }))
  const totalStats = stats.reduce((sum: number, s: any) => sum + s.value, 0)
  const dexNumber = String(pokeData.id).padStart(3, '0')
  const artworkUrl = proxyImg(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeData.id}.png`) || ''
  const isLegendary = !!speciesData?.is_legendary
  const isMythical  = !!speciesData?.is_mythical
  const genus = speciesData?.genera?.find((g: any) => g.language.name === 'en')?.genus
  const heightM = (pokeData.height / 10).toFixed(1)
  const weightKg = (pokeData.weight / 10).toFixed(1)
  const abilities = pokeData.abilities
    .map((a: any) => a.ability.name.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' '))
    .slice(0, 3)
  const primaryAbility = abilities[0] || '—'

  const featured = mostExpensivePsa10?.psa10_usd ? mostExpensivePsa10 : mostExpensiveRaw
  const featuredPrice = featured?.psa10_usd ?? featured?.raw_usd ?? null
  const featuredGrade = featured?.psa10_usd ? 'PSA 10' : 'Raw'
  const headerStat = featured ? fmtPrice(featuredPrice) : '—'
  const headerStatLabel = featured ? `Max ${featuredGrade}` : 'Max value'

  // Auto-scale display name. Long names shrink so they always fit on one line.
  const nameLen = displayName.length
  const nameSize = nameLen > 14 ? 64 : nameLen > 10 ? 80 : 96

  // Section heights — total = 1080
  // Hero shrunk by 20px so the collector-stats panel sits higher on the
  // canvas. Featured section grew by 20px (~14%) so the most-valuable-card
  // band has more breathing room and a bigger card thumbnail.
  const H_HEADER  = 90
  const H_HERO    = 490
  const H_STATS   = 130
  const H_BATTLE  = 210
  const H_FOOTER  = 160
  // 90 + 490 + 130 + 210 + 160 = 1080

  return (
    <div
      id="pokemon-insight-card"
      style={{
        width: 1080,
        height: 1080,
        boxSizing: 'border-box',
        background: `linear-gradient(165deg, ${tc.bg} 0%, ${tc.bg2} 50%, #0c0c18 100%)`,
        color: tc.text,
        fontFamily: "'Figtree', sans-serif",
        display: 'grid',
        gridTemplateRows: `${H_HEADER}px ${H_HERO}px ${H_STATS}px ${H_BATTLE}px ${H_FOOTER}px`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative blur in top-right */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -220, right: -180,
          width: 720, height: 720,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${tc.bg}aa, transparent 65%)`,
          filter: 'blur(60px)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* HEADER — bigger label and dex# */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '20px 52px 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        whiteSpace: 'nowrap',
      }}>
        <div style={{ whiteSpace: 'nowrap' }}>
          <div style={{
            fontSize: 22, fontWeight: 900, letterSpacing: 6,
            opacity: 0.85, textTransform: 'uppercase',
            whiteSpace: 'nowrap', lineHeight: 1,
          }}>
            POKÉMON DOSSIER
          </div>
          <div style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 32, fontWeight: 900, opacity: 0.85,
            marginTop: 6, whiteSpace: 'nowrap', lineHeight: 1,
            letterSpacing: -0.5,
          }}>
            #{dexNumber}
          </div>
        </div>
        <div style={{
          fontSize: 30, fontWeight: 900, letterSpacing: 2.5,
          fontFamily: "'Outfit', sans-serif",
          whiteSpace: 'nowrap',
        }}>
          POKEPRICES
        </div>
      </div>

      {/* HERO — 3-col row (types | artwork | dex info), then name + genus */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '8px 40px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        overflow: 'hidden',
      }}>
        {/* 3-column row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
          height: 290,
        }}>
          {/* LEFT — type chips stacked vertically */}
          <div style={{
            width: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'stretch',
          }}>
            {types.map(t => (
              <div key={t} style={{
                background: 'rgba(0,0,0,0.34)',
                border: '2px solid rgba(255,255,255,0.32)',
                padding: '10px 18px',
                borderRadius: 14,
                fontSize: 18, fontWeight: 900,
                textTransform: 'uppercase', letterSpacing: 1.8,
                textAlign: 'center', whiteSpace: 'nowrap',
              }}>
                {t}
              </div>
            ))}
            {isLegendary && (
              <div style={{
                background: '#FFD166', color: '#1a1a1a',
                padding: '10px 18px', borderRadius: 14,
                fontSize: 16, fontWeight: 900,
                textTransform: 'uppercase', letterSpacing: 1.6,
                textAlign: 'center', whiteSpace: 'nowrap',
              }}>
                ★ Legendary
              </div>
            )}
            {isMythical && (
              <div style={{
                background: '#C77DFF', color: '#fff',
                padding: '10px 18px', borderRadius: 14,
                fontSize: 16, fontWeight: 900,
                textTransform: 'uppercase', letterSpacing: 1.6,
                textAlign: 'center', whiteSpace: 'nowrap',
              }}>
                ✦ Mythical
              </div>
            )}
          </div>

          {/* CENTRE — artwork (crossOrigin so canvas extraction works on iOS) */}
          <img
            crossOrigin="anonymous"
            src={artworkUrl}
            alt={displayName}
            style={{
              width: 280, height: 280, objectFit: 'contain',
              filter: 'drop-shadow(0 14px 36px rgba(0,0,0,0.5))',
              display: 'block',
              flexShrink: 0,
            }}
          />

          {/* RIGHT — Pokédex info stacked */}
          <div style={{
            width: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            textAlign: 'right',
          }}>
            <InfoBlock label="Height" value={`${heightM}m`} />
            <InfoBlock label="Weight" value={`${weightKg}kg`} />
            <InfoBlock label="Ability" value={primaryAbility} />
          </div>
        </div>

        {/* Name + genus, centred under the row */}
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <h1 style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: nameSize,
            fontWeight: 900,
            letterSpacing: -2,
            margin: 0,
            textTransform: 'capitalize',
            textShadow: '0 4px 16px rgba(0,0,0,0.35)',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {displayName}
          </h1>
          {genus && (
            <div style={{
              fontSize: 22, fontStyle: 'italic',
              opacity: 0.85, marginTop: 8,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}>
              The {genus}
            </div>
          )}
        </div>
      </div>

      {/* COLLECTOR STATS panel — slightly larger numbers */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '0 52px',
        display: 'flex',
        alignItems: 'center',
      }}>
        <div style={{
          width: '100%',
          background: 'rgba(0,0,0,0.42)',
          backdropFilter: 'blur(8px)',
          border: '1.5px solid rgba(255,255,255,0.18)',
          borderRadius: 22,
          padding: '20px 28px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 16,
        }}>
          <BigStat big={String(cards.length)}    small="Cards Tracked" />
          <BigStat big={String(uniqueSetCount)}  small="Sets Featured" />
          <BigStat big={headerStat}              small={headerStatLabel} />
        </div>
      </div>

      {/* BATTLE STATS — bigger labels and values */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '14px 52px 0',
        overflow: 'hidden',
      }}>
        <div style={{
          fontSize: 16, fontWeight: 900, letterSpacing: 4,
          opacity: 0.85, marginBottom: 16, textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
          Battle Stats <span style={{ opacity: 0.55, fontWeight: 700 }}>· {totalStats} total</span>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: 'repeat(3, 1fr)',
          columnGap: 40,
          rowGap: 12,
          height: 138,
        }}>
          {stats.map((s: any) => (
            <StatBar
              key={s.name}
              name={STAT_LABEL[s.name] ?? s.name}
              value={s.value}
              accent={tc.bg}
            />
          ))}
        </div>
      </div>

      {/* FEATURED CARD + FOOTER — taller band, bigger card thumbnail and text */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '14px 52px 16px',
        background: 'rgba(0,0,0,0.55)',
        borderTop: '1px solid rgba(255,255,255,0.18)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}>
        {featured ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 20,
            whiteSpace: 'nowrap',
          }}>
            {featured.image_url && (
              <img
                crossOrigin="anonymous"
                src={proxyImg(featured.image_url) || ''}
                alt={featured.card_name}
                style={{
                  width: 88, height: 122, objectFit: 'contain',
                  borderRadius: 7, flexShrink: 0,
                  background: 'rgba(255,255,255,0.04)',
                  boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{
                fontSize: 13, fontWeight: 900, letterSpacing: 2.5,
                opacity: 0.72, textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                Most Valuable Card
              </div>
              <div style={{
                fontSize: 30, fontWeight: 900, marginTop: 5,
                fontFamily: "'Outfit', sans-serif",
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.1,
                letterSpacing: -0.3,
              }}>
                {featured.card_name}
              </div>
              <div style={{
                fontSize: 16, opacity: 0.85, marginTop: 5, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {featured.set_name}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <div style={{
                fontSize: 44, fontWeight: 900,
                fontFamily: "'Outfit', sans-serif", lineHeight: 1,
                color: tc.accent,
                textShadow: '0 2px 12px rgba(0,0,0,0.3)',
                letterSpacing: -1,
              }}>
                {fmtPrice(featuredPrice)}
              </div>
              <div style={{
                fontSize: 14, fontWeight: 800, opacity: 0.78,
                letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 6,
              }}>
                {featuredGrade}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontSize: 14, opacity: 0.7 }}>
            No card price data yet.
          </div>
        )}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13, opacity: 0.6, fontWeight: 700, letterSpacing: 1,
          whiteSpace: 'nowrap',
        }}>
          <span>pokeprices.io</span>
          <span>Live prices · Updated daily</span>
        </div>
      </div>
    </div>
  )
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ whiteSpace: 'nowrap' }}>
      <div style={{
        fontSize: 12, fontWeight: 900, opacity: 0.6,
        letterSpacing: 2, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 900,
        fontFamily: "'Outfit', sans-serif",
        marginTop: 2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        letterSpacing: -0.3,
      }}>
        {value}
      </div>
    </div>
  )
}

function BigStat({ big, small }: { big: string; small: string }) {
  return (
    <div style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <div style={{
        fontSize: 52, fontWeight: 900, lineHeight: 1,
        fontFamily: "'Outfit', sans-serif", letterSpacing: -1.2,
        whiteSpace: 'nowrap',
      }}>
        {big}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 900, letterSpacing: 1.8,
        opacity: 0.78, marginTop: 8, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {small}
      </div>
    </div>
  )
}

function StatBar({ name, value, accent }: { name: string; value: number; accent: string }) {
  // 200 visual cap (max base stat in main games is 255)
  const pct = Math.min(100, (value / 200) * 100)
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '90px 60px 1fr',
      alignItems: 'center',
      gap: 14,
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        fontSize: 17, fontWeight: 900, opacity: 0.92,
        letterSpacing: 1, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {name}
      </span>
      <span style={{
        fontSize: 28, fontWeight: 900,
        fontFamily: "'Outfit', sans-serif",
        textAlign: 'right',
        whiteSpace: 'nowrap',
        letterSpacing: -0.5,
      }}>
        {value}
      </span>
      <div style={{
        height: 14, background: 'rgba(0,0,0,0.4)',
        borderRadius: 99, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.12)',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: `linear-gradient(90deg, ${accent} 0%, rgba(255,255,255,0.6) 100%)`,
          borderRadius: 99,
        }} />
      </div>
    </div>
  )
}
