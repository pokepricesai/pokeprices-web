// PokemonInsightCard — 1080×1080 shareable "Collector's Dossier".
// Uses CSS grid with explicit row heights so html-to-image cannot collapse
// or overlap sections. Text elements that must stay on one line use
// whiteSpace: 'nowrap' (works around a flexbox quirk where align-items: center
// on a column shrinks children to their min-content width).

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

  const featured = mostExpensivePsa10?.psa10_usd ? mostExpensivePsa10 : mostExpensiveRaw
  const featuredPrice = featured?.psa10_usd ?? featured?.raw_usd ?? null
  const featuredGrade = featured?.psa10_usd ? 'PSA 10' : 'Raw'
  const headerStat = featured ? fmtPrice(featuredPrice) : '—'
  const headerStatLabel = featured ? `Max ${featuredGrade}` : 'Max value'

  // Auto-scale display name. With whiteSpace: nowrap we don't need to fear
  // wraps, but very long names would still overflow horizontally — so shrink.
  const nameLen = displayName.length
  const nameSize = nameLen > 14 ? 60 : nameLen > 10 ? 76 : 92

  // Section heights — total = 1080
  const H_HEADER  = 70
  const H_HERO    = 540
  const H_STATS   = 130
  const H_BATTLE  = 210
  const H_FOOTER  = 130
  // = 70 + 540 + 130 + 210 + 130 = 1080

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

      {/* HEADER */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '0 52px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        whiteSpace: 'nowrap',
      }}>
        <div style={{ whiteSpace: 'nowrap' }}>
          <div style={{
            fontSize: 16, fontWeight: 900, letterSpacing: 5,
            opacity: 0.85, textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}>
            POKÉMON DOSSIER
          </div>
          <div style={{
            fontSize: 14, fontWeight: 700, opacity: 0.7,
            marginTop: 2, whiteSpace: 'nowrap',
          }}>
            #{dexNumber}
          </div>
        </div>
        <div style={{
          fontSize: 24, fontWeight: 900, letterSpacing: 2,
          fontFamily: "'Outfit', sans-serif",
          whiteSpace: 'nowrap',
        }}>
          POKEPRICES
        </div>
      </div>

      {/* HERO — uses block layout with text-align: center to avoid flex
          shrinking children to min-content width. */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '4px 40px 0',
        textAlign: 'center',
        overflow: 'hidden',
      }}>
        <img
          src={artworkUrl}
          alt={displayName}
          style={{
            width: 280, height: 280, objectFit: 'contain',
            filter: 'drop-shadow(0 14px 36px rgba(0,0,0,0.5))',
            display: 'block', margin: '0 auto',
          }}
        />
        <h1 style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: nameSize,
          fontWeight: 900,
          letterSpacing: -2,
          margin: '6px 0 0',
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
            fontSize: 18, fontStyle: 'italic',
            opacity: 0.85, marginTop: 8,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            The {genus}
          </div>
        )}
        <div style={{
          marginTop: 12,
          display: 'inline-flex',
          gap: 10,
          flexWrap: 'nowrap',
          justifyContent: 'center',
          alignItems: 'center',
          whiteSpace: 'nowrap',
        }}>
          {types.map(t => (
            <span key={t} style={{
              background: 'rgba(0,0,0,0.32)',
              border: '2px solid rgba(255,255,255,0.3)',
              padding: '7px 20px', borderRadius: 32,
              fontSize: 15, fontWeight: 900,
              textTransform: 'uppercase', letterSpacing: 2,
              whiteSpace: 'nowrap',
            }}>
              {t}
            </span>
          ))}
          {isLegendary && (
            <span style={{
              background: '#FFD166', color: '#1a1a1a',
              padding: '7px 18px', borderRadius: 32,
              fontSize: 15, fontWeight: 900,
              textTransform: 'uppercase', letterSpacing: 2,
              whiteSpace: 'nowrap',
            }}>
              ★ Legendary
            </span>
          )}
          {isMythical && (
            <span style={{
              background: '#C77DFF', color: '#fff',
              padding: '7px 18px', borderRadius: 32,
              fontSize: 15, fontWeight: 900,
              textTransform: 'uppercase', letterSpacing: 2,
              whiteSpace: 'nowrap',
            }}>
              ✦ Mythical
            </span>
          )}
        </div>
        <div style={{
          marginTop: 14,
          fontSize: 15, fontWeight: 700,
          opacity: 0.92,
          whiteSpace: 'nowrap',
        }}>
          <span style={{ opacity: 0.6, marginRight: 4 }}>HT</span>{heightM}m
          <span style={{ margin: '0 12px', opacity: 0.4 }}>·</span>
          <span style={{ opacity: 0.6, marginRight: 4 }}>WT</span>{weightKg}kg
          {abilities.length > 0 && (
            <>
              <span style={{ margin: '0 12px', opacity: 0.4 }}>·</span>
              <span style={{ opacity: 0.6, marginRight: 4 }}>ABILITY</span>{abilities[0]}
            </>
          )}
        </div>
      </div>

      {/* COLLECTOR STATS */}
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

      {/* BATTLE STATS */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '12px 52px 0',
        overflow: 'hidden',
      }}>
        <div style={{
          fontSize: 14, fontWeight: 900, letterSpacing: 4,
          opacity: 0.85, marginBottom: 14, textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
          Battle Stats <span style={{ opacity: 0.55, fontWeight: 700 }}>· {totalStats} total</span>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: 'repeat(3, 1fr)',
          columnGap: 36,
          rowGap: 10,
          height: 145,
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

      {/* FEATURED CARD + FOOTER */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '14px 52px 18px',
        background: 'rgba(0,0,0,0.55)',
        borderTop: '1px solid rgba(255,255,255,0.18)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}>
        {featured ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16,
            whiteSpace: 'nowrap',
          }}>
            {featured.image_url && (
              <img
                crossOrigin="anonymous"
                src={proxyImg(featured.image_url) || ''}
                alt={featured.card_name}
                style={{
                  width: 64, height: 90, objectFit: 'contain',
                  borderRadius: 5, flexShrink: 0,
                  background: 'rgba(255,255,255,0.04)',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{
                fontSize: 11, fontWeight: 900, letterSpacing: 2.5,
                opacity: 0.7, textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                Most Valuable Card
              </div>
              <div style={{
                fontSize: 22, fontWeight: 900, marginTop: 2,
                fontFamily: "'Outfit', sans-serif",
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.1,
              }}>
                {featured.card_name}
              </div>
              <div style={{
                fontSize: 13, opacity: 0.85, marginTop: 4, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {featured.set_name}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <div style={{
                fontSize: 30, fontWeight: 900,
                fontFamily: "'Outfit', sans-serif", lineHeight: 1,
                color: tc.accent,
                textShadow: '0 2px 12px rgba(0,0,0,0.3)',
              }}>
                {fmtPrice(featuredPrice)}
              </div>
              <div style={{
                fontSize: 11, fontWeight: 800, opacity: 0.75,
                letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4,
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
          fontSize: 12, opacity: 0.55, fontWeight: 700, letterSpacing: 1,
          whiteSpace: 'nowrap',
        }}>
          <span>pokeprices.io</span>
          <span>Live prices · Updated daily</span>
        </div>
      </div>
    </div>
  )
}

function BigStat({ big, small }: { big: string; small: string }) {
  return (
    <div style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <div style={{
        fontSize: 44, fontWeight: 900, lineHeight: 1,
        fontFamily: "'Outfit', sans-serif", letterSpacing: -1,
        whiteSpace: 'nowrap',
      }}>
        {big}
      </div>
      <div style={{
        fontSize: 12, fontWeight: 900, letterSpacing: 1.8,
        opacity: 0.75, marginTop: 7, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {small}
      </div>
    </div>
  )
}

function StatBar({ name, value, accent }: { name: string; value: number; accent: string }) {
  // 200 visual cap (max base stat in main games is 255, but anything above
  // ~150 is essentially "full").
  const pct = Math.min(100, (value / 200) * 100)
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '78px 48px 1fr',
      alignItems: 'center',
      gap: 12,
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        fontSize: 14, fontWeight: 900, opacity: 0.9,
        letterSpacing: 1, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {name}
      </span>
      <span style={{
        fontSize: 20, fontWeight: 900,
        fontFamily: "'Outfit', sans-serif",
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
      <div style={{
        height: 11, background: 'rgba(0,0,0,0.4)',
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
