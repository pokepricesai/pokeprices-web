// PokemonInsightCard — 1080×1080 shareable "Collector's Dossier".
// Layout uses CSS grid with explicit row heights so html-to-image cannot
// collapse or overlap sections, and a 3-column hero with type chips on the
// left, artwork centred, and Pokédex info (HT/WT/ABILITY) on the right.
//
// Design: light/pastel type-coloured background, white panels with
// type-coloured borders, dark text with white halo for legibility.
// Replaces the older "white text on black panels" look.

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

// Each entry has:
//   bg      — saturated type colour, used for borders / icons / accents
//   bg2     — deeper saturated type colour, for value highlights and headers
//   bgLight — bg mixed with white ~50%, for label text on slate panels
//             (saturated tc.bg felt heavy on the slate; this reads brighter)
//   pastel  — type tint for the outer canvas. More saturated than the previous
//             pass — was washed-out off-white, now reads as a real type colour
//             at low intensity.
//   ink     — dark text colour tuned to the type, mostly the same dark navy
const TYPE_COLORS: Record<string, { bg: string; bg2: string; bgLight: string; pastel: string; ink: string }> = {
  fire:     { bg: '#E07623', bg2: '#A04D14', bgLight: '#F0BB91', pastel: '#FCC79C', ink: '#3A1A05' },
  water:    { bg: '#3F76D9', bg2: '#22458C', bgLight: '#9FBBEC', pastel: '#ACC2EE', ink: '#0F2347' },
  grass:    { bg: '#3FA224', bg2: '#225A11', bgLight: '#9FD192', pastel: '#AEDCA0', ink: '#10330A' },
  electric: { bg: '#C28B0A', bg2: '#7A5A04', bgLight: '#E1C585', pastel: '#EBD387', ink: '#3A2A02' },
  psychic:  { bg: '#DC2A6C', bg2: '#8C1644', bgLight: '#EE95B6', pastel: '#F4A6BD', ink: '#3D0A1F' },
  ice:      { bg: '#3D9C99', bg2: '#1F5F5D', bgLight: '#9ECECC', pastel: '#A6D5D2', ink: '#0E2C2B' },
  dragon:   { bg: '#5C25E0', bg2: '#321485', bgLight: '#AE92F0', pastel: '#B299F4', ink: '#1A0A4A' },
  dark:     { bg: '#5A4234', bg2: '#2D1F18', bgLight: '#ACA19A', pastel: '#BFB1A8', ink: '#1F140C' },
  fairy:    { bg: '#C24F87', bg2: '#7A2752', bgLight: '#E1A7C3', pastel: '#E5A8C2', ink: '#3D0F2A' },
  fighting: { bg: '#A82420', bg2: '#5C100D', bgLight: '#D49290', pastel: '#DEA3A1', ink: '#2A0907' },
  poison:   { bg: '#8A2E89', bg2: '#4D154B', bgLight: '#C597C4', pastel: '#C8A1C7', ink: '#290D29' },
  ground:   { bg: '#A87E27', bg2: '#5F4710', bgLight: '#D4BF93', pastel: '#D8C290', ink: '#2D1F08' },
  rock:     { bg: '#897925', bg2: '#544811', bgLight: '#C4BC92', pastel: '#C9BD89', ink: '#241D08' },
  bug:      { bg: '#7A8810', bg2: '#414A06', bgLight: '#BDC488', pastel: '#C2CC8A', ink: '#1F2305' },
  ghost:    { bg: '#5A4378', bg2: '#332343', bgLight: '#ACA1BC', pastel: '#B6A8C8', ink: '#1A1126' },
  steel:    { bg: '#566677', bg2: '#2C3645', bgLight: '#ABB3BB', pastel: '#ACBAC7', ink: '#15202B' },
  normal:   { bg: '#6E6E48', bg2: '#3F3F26', bgLight: '#B7B7A4', pastel: '#B7B79A', ink: '#1F1F0E' },
  flying:   { bg: '#5848B6', bg2: '#2E2473', bgLight: '#ACA4DB', pastel: '#A89FDB', ink: '#180F4A' },
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

// Card-look surface shared across all panels: a mid slate (20% lighter
// than the previous pass — was rgb(45,49,66), now rgb(87,90,104)). White
// text still reads crisp; type-coloured accents on the labels keep it
// on-brand.
const PANEL_BG = 'rgba(87, 90, 104, 0.94)'

function panelStyle(bg: string): React.CSSProperties {
  return {
    background: PANEL_BG,
    border: `2px solid ${bg}55`,
    borderRadius: 22,
    boxShadow: '0 8px 28px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.08)',
  }
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
  const tc = TYPE_COLORS[primaryType] ?? { bg: '#3b8fe8', bg2: '#1a5fad', bgLight: '#A4C5EE', pastel: '#A8C2EC', ink: '#0F2347' }
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
  const H_HEADER  = 90
  const H_HERO    = 490
  const H_STATS   = 130
  const H_BATTLE  = 210
  const H_FOOTER  = 160

  return (
    <div
      id="pokemon-insight-card"
      style={{
        width: 1080,
        height: 1080,
        boxSizing: 'border-box',
        // Soft pastel gradient, ~10% darker than the last pass (was fading
        // to #f7f7fb / #fff). Brings the canvas down a notch so the slate
        // panels don't shout against blown-out white.
        background: `linear-gradient(155deg, ${tc.pastel} 0%, #e8e8ee 70%, #dadce4 100%)`,
        color: tc.ink,
        // White halo on every text descendant so dark text reads cleanly on
        // the pastel-tinted areas. Replaces the old dark drop-shadow that
        // was paired with white text.
        textShadow: '0 1px 2px rgba(255,255,255,0.85), 0 0 1px rgba(255,255,255,0.6)',
        fontFamily: "'Figtree', sans-serif",
        display: 'grid',
        gridTemplateRows: `${H_HEADER}px ${H_HERO}px ${H_STATS}px ${H_BATTLE}px ${H_FOOTER}px`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative blur in top-right — soft, low-opacity type accent */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -220, right: -180,
          width: 720, height: 720,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${tc.bg}33, transparent 65%)`,
          filter: 'blur(60px)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Vignette — transparent at centre, ~15% darker at the corners. Pulls
          the eye toward the centred Pokémon artwork in the hero band. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.15) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Highlight glow behind the artwork — bright soft halo at ~50% x, 30% y
          where the Pokémon image sits in the hero band. Adds depth and a
          subtle stage-light effect without touching the rest of the layout. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.18) 18%, transparent 40%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* HEADER */}
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
            color: tc.bg2, textTransform: 'uppercase',
            whiteSpace: 'nowrap', lineHeight: 1,
          }}>
            POKÉMON DOSSIER
          </div>
          <div style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 32, fontWeight: 900, color: tc.ink, opacity: 0.55,
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
          color: tc.bg2,
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
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
          height: 290,
        }}>
          {/* LEFT — type chips: white card, coloured border + text */}
          <div style={{
            width: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'stretch',
          }}>
            {types.map(t => {
              const ttc = TYPE_COLORS[t] ?? tc
              return (
                <div key={t} style={{
                  background: '#fff',
                  border: `2.5px solid ${ttc.bg}`,
                  padding: '10px 18px',
                  borderRadius: 14,
                  fontSize: 18, fontWeight: 900,
                  textTransform: 'uppercase', letterSpacing: 1.8,
                  textAlign: 'center', whiteSpace: 'nowrap',
                  color: ttc.bg2,
                  textShadow: 'none',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                }}>
                  {t}
                </div>
              )
            })}
            {isLegendary && (
              <div style={{
                background: '#FFF2BF', border: '2.5px solid #E0B821',
                color: '#5A3D02',
                padding: '10px 18px', borderRadius: 14,
                fontSize: 16, fontWeight: 900,
                textTransform: 'uppercase', letterSpacing: 1.6,
                textAlign: 'center', whiteSpace: 'nowrap',
                textShadow: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                ★ Legendary
              </div>
            )}
            {isMythical && (
              <div style={{
                background: '#EAD9FB', border: '2.5px solid #9B5BD8',
                color: '#3D0E63',
                padding: '10px 18px', borderRadius: 14,
                fontSize: 16, fontWeight: 900,
                textTransform: 'uppercase', letterSpacing: 1.6,
                textAlign: 'center', whiteSpace: 'nowrap',
                textShadow: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                ✦ Mythical
              </div>
            )}
          </div>

          {/* CENTRE — artwork */}
          <img
            crossOrigin="anonymous"
            src={artworkUrl}
            alt={displayName}
            style={{
              width: 280, height: 280, objectFit: 'contain',
              filter: 'drop-shadow(0 14px 36px rgba(0,0,0,0.18))',
              display: 'block',
              flexShrink: 0,
            }}
          />

          {/* RIGHT — Pokédex info */}
          <div style={{
            width: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            textAlign: 'right',
          }}>
            <InfoBlock label="Height" value={`${heightM}m`} accent={tc.bg2} ink={tc.ink} />
            <InfoBlock label="Weight" value={`${weightKg}kg`} accent={tc.bg2} ink={tc.ink} />
            <InfoBlock label="Ability" value={primaryAbility} accent={tc.bg2} ink={tc.ink} />
          </div>
        </div>

        {/* Name + genus */}
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <h1 style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: nameSize,
            fontWeight: 900,
            letterSpacing: -2,
            margin: 0,
            textTransform: 'capitalize',
            // Light halo around the dark display name keeps it crisp on the
            // pastel canvas without resorting to a black background panel.
            textShadow: '0 2px 0 rgba(255,255,255,0.9), 0 0 12px rgba(255,255,255,0.6)',
            color: tc.ink,
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
              color: tc.bg2, marginTop: 8,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              textShadow: 'none',
            }}>
              The {genus}
            </div>
          )}
        </div>
      </div>

      {/* COLLECTOR STATS panel — slate card, white numbers, type-coloured labels */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '0 52px',
        display: 'flex',
        alignItems: 'center',
      }}>
        <div style={{
          ...panelStyle(tc.bg),
          width: '100%',
          padding: '20px 28px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 16,
          color: '#fff',
        }}>
          <BigStat big={String(cards.length)}    small="Total Cards"    accent={tc.bgLight} ink="#fff" />
          <BigStat big={String(uniqueSetCount)}  small="Sets Featured"  accent={tc.bgLight} ink="#fff" />
          <BigStat big={headerStat}              small={headerStatLabel} accent={tc.bgLight} ink="#fff" />
        </div>
      </div>

      {/* BATTLE STATS — dark text on pastel bg, type-coloured bars */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '14px 52px 0',
        overflow: 'hidden',
        color: tc.ink,
      }}>
        <div style={{
          fontSize: 16, fontWeight: 900, letterSpacing: 4,
          color: tc.bg2, marginBottom: 16, textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          textShadow: 'none',
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
              ink={tc.ink}
            />
          ))}
        </div>
      </div>

      {/* FEATURED CARD + FOOTER — slate band, white text, type-coloured price */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '14px 52px 16px',
        background: PANEL_BG,
        borderTop: `2px solid ${tc.bg}55`,
        color: '#fff',
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
                  background: 'rgba(255,255,255,0.06)',
                  boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{
                fontSize: 13, fontWeight: 900, letterSpacing: 2.5,
                color: tc.bgLight, textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                textShadow: 'none',
              }}>
                Most Valuable Card
              </div>
              <div style={{
                fontSize: 30, fontWeight: 900, marginTop: 5,
                fontFamily: "'Outfit', sans-serif",
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.1,
                letterSpacing: -0.3,
                color: '#fff',
                textShadow: 'none',
              }}>
                {featured.card_name}
              </div>
              <div style={{
                fontSize: 16, color: 'rgba(255,255,255,0.75)', marginTop: 5, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                textShadow: 'none',
              }}>
                {featured.set_name}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <div style={{
                fontSize: 44, fontWeight: 900,
                fontFamily: "'Outfit', sans-serif", lineHeight: 1,
                color: tc.bgLight,
                letterSpacing: -1,
                textShadow: '0 2px 6px rgba(0,0,0,0.35)',
              }}>
                {fmtPrice(featuredPrice)}
              </div>
              <div style={{
                fontSize: 14, fontWeight: 800, color: tc.bgLight, opacity: 0.95,
                letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 6,
                textShadow: 'none',
              }}>
                {featuredGrade}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
            No card price data yet.
          </div>
        )}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: 700, letterSpacing: 1,
          whiteSpace: 'nowrap',
          textShadow: 'none',
        }}>
          <span>pokeprices.io</span>
          <span>Live prices · Updated daily</span>
        </div>
      </div>
    </div>
  )
}

function InfoBlock({ label, value, accent, ink }: { label: string; value: string; accent: string; ink: string }) {
  return (
    <div style={{ whiteSpace: 'nowrap' }}>
      <div style={{
        fontSize: 12, fontWeight: 900, color: accent, opacity: 0.85,
        letterSpacing: 2, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        textShadow: 'none',
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
        color: ink,
        textShadow: 'none',
      }}>
        {value}
      </div>
    </div>
  )
}

function BigStat({ big, small, accent, ink }: { big: string; small: string; accent: string; ink: string }) {
  return (
    <div style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <div style={{
        fontSize: 52, fontWeight: 900, lineHeight: 1,
        fontFamily: "'Outfit', sans-serif", letterSpacing: -1.2,
        whiteSpace: 'nowrap',
        color: ink,
        textShadow: 'none',
      }}>
        {big}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 900, letterSpacing: 1.8,
        color: accent, opacity: 0.9, marginTop: 8, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        textShadow: 'none',
      }}>
        {small}
      </div>
    </div>
  )
}

function StatBar({ name, value, accent, ink }: { name: string; value: number; accent: string; ink: string }) {
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
        fontSize: 17, fontWeight: 900, color: ink, opacity: 0.85,
        letterSpacing: 1, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        textShadow: 'none',
      }}>
        {name}
      </span>
      <span style={{
        fontSize: 28, fontWeight: 900,
        fontFamily: "'Outfit', sans-serif",
        textAlign: 'right',
        whiteSpace: 'nowrap',
        letterSpacing: -0.5,
        color: ink,
        textShadow: 'none',
      }}>
        {value}
      </span>
      <div style={{
        height: 14, background: 'rgba(0,0,0,0.08)',
        borderRadius: 99, overflow: 'hidden',
        border: '1px solid rgba(0,0,0,0.06)',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: accent,
          borderRadius: 99,
        }} />
      </div>
    </div>
  )
}
