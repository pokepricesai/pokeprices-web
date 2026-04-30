// PokemonInsightCard — 1080×1080 shareable "Collector's Dossier".
// Layout uses CSS grid with explicit row heights so html-to-image cannot
// collapse or overlap sections. Same 5-row structure as before:
// HEADER / HERO / STATS / BATTLE / FOOTER. Only visuals change in this pass.
//
// Design language: deep saturated type gradient, glassy slate panels with
// shadows + subtle borders, Pokémon image right-aligned with a cyan glow
// halo, yellow-gold price highlight, type-coloured pill chips, faint
// Pokéball corner accent for designed-not-generated feel.

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

// bg / bg2 drive the saturated background gradient. bgLight is bg mixed
// ~50% with white — used for label text and stat-bar highlights so they
// pop against the dark canvas. Pastel/ink retained for back-compat in
// case other code references them.
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

// Brand gold used for price/value highlights, regardless of type. Same
// "money colour" across every dossier so collectors know where to look.
const GOLD = '#FFD84D'

// Slate panel base — used for collector stats + featured card containers.
// Dark-but-not-black so it pops against the saturated canvas without
// reading as "black bars".
const PANEL_BG = 'rgba(51, 54, 69, 0.62)'
const PANEL_BORDER = '1px solid rgba(255, 255, 255, 0.10)'

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

  // Auto-scale display name to fit the 480px left column without showing
  // an ellipsis. Granular breakpoints because the previous pass had a big
  // gap (10 -> 118) that broke 9-letter names like Wartortle, Bulbasaur,
  // Charizard. Average glyph advance at the chosen sizes is ~55-65px so
  // 9 chars × 55 ≈ 495 still fits at 92px.
  const nameLen = displayName.length
  const nameSize =
      nameLen <= 6  ? 118
    : nameLen <= 8  ? 108
    : nameLen <= 10 ? 92
    : nameLen <= 13 ? 78
    :                 64

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
        // Saturated type gradient. Same colour family across the canvas
        // so the dossier feels on-brand for the species without reading
        // as a generic dark mode panel.
        background: `linear-gradient(165deg, ${tc.bg} 0%, ${tc.bg2} 100%)`,
        color: '#fff',
        // Subtle dark halo on every text descendant — keeps white text
        // legible against any type's saturation level.
        textShadow: '0 2px 4px rgba(0,0,0,0.45), 0 0 1px rgba(0,0,0,0.6)',
        fontFamily: "'Figtree', sans-serif",
        display: 'grid',
        gridTemplateRows: `${H_HEADER}px ${H_HERO}px ${H_STATS}px ${H_BATTLE}px ${H_FOOTER}px`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Soft type accent in the top-right — quieter than before */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -220, right: -180,
          width: 720, height: 720,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${tc.bgLight}33, transparent 65%)`,
          filter: 'blur(60px)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Vignette — slightly stronger so the corners frame the saturated bg */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.20) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Cyan glow halo behind the Pokémon — boosted opacity so it actually
          shows through the saturated canvas. Sized ~120% of artwork. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 110, right: 10,
          width: 560, height: 560,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,210,255,0.55) 0%, rgba(120,230,255,0.28) 30%, rgba(0,210,255,0.08) 55%, transparent 75%)',
          filter: 'blur(36px)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Faint Pokéball corner accent — designed-not-generated touch */}
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        style={{
          position: 'absolute',
          bottom: -28, left: -28,
          width: 240, height: 240,
          opacity: 0.07,
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        <circle cx="50" cy="50" r="46" fill="none" stroke="#fff" strokeWidth="3" />
        <line x1="4" y1="50" x2="96" y2="50" stroke="#fff" strokeWidth="3" />
        <circle cx="50" cy="50" r="14" fill="none" stroke="#fff" strokeWidth="3" />
        <circle cx="50" cy="50" r="7"  fill="none" stroke="#fff" strokeWidth="3" />
      </svg>

      {/* FLOATING POKÉMON ARTWORK — positioned absolutely at the root canvas
          (rather than inside the hero) so the bottom can overlap slightly
          into the collector-stats panel. zIndex stacks above the panel. */}
      <img
        crossOrigin="anonymous"
        src={artworkUrl}
        alt={displayName}
        style={{
          position: 'absolute',
          top: 110, right: 28,
          width: 480, height: 480,
          objectFit: 'contain',
          filter: 'drop-shadow(0 22px 50px rgba(0,0,0,0.55)) drop-shadow(0 0 24px rgba(0,210,255,0.20))',
          zIndex: 4,
          pointerEvents: 'none',
        }}
      />

      {/* HEADER */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '22px 52px 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        whiteSpace: 'nowrap',
      }}>
        <div style={{ whiteSpace: 'nowrap' }}>
          <div style={{
            fontSize: 22, fontWeight: 900, letterSpacing: 6,
            color: '#fff', opacity: 0.85,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap', lineHeight: 1,
          }}>
            POKÉMON DOSSIER
          </div>
          <div style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 32, fontWeight: 900,
            color: '#fff', opacity: 0.6,
            marginTop: 6, whiteSpace: 'nowrap', lineHeight: 1,
            letterSpacing: -0.5,
          }}>
            #{dexNumber}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 30, fontWeight: 900, letterSpacing: 2.5,
            fontFamily: "'Outfit', sans-serif",
            whiteSpace: 'nowrap',
            color: GOLD,
            textShadow: '0 2px 6px rgba(0,0,0,0.45)',
          }}>
            POKEPRICES
          </div>
          <div style={{
            fontSize: 13, fontWeight: 700, letterSpacing: 2.2,
            color: '#fff', opacity: 0.7,
            marginTop: 6, whiteSpace: 'nowrap',
            textTransform: 'uppercase',
          }}>
            Live market data
          </div>
        </div>
      </div>

      {/* HERO — left column has the name + chips + dex info packed top-to-
          bottom; the right column is empty because the floating artwork
          (rendered at root above) overlays it. No more dead vertical space
          between the chip and the dex info. */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '14px 0 0 52px',
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        boxSizing: 'border-box',
      }}>
        {/* LEFT — name + chips + dex info, stacked tightly from top */}
        <div style={{
          width: 480,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          paddingRight: 16,
        }}>
          {/* Name + genus */}
          <div>
            <h1 style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: nameSize,
              fontWeight: 900,
              letterSpacing: -2.5,
              margin: 0,
              textTransform: 'capitalize',
              textShadow: '0 6px 22px rgba(0,0,0,0.55), 0 2px 0 rgba(0,0,0,0.35)',
              color: '#fff',
              lineHeight: 0.92,
              whiteSpace: 'nowrap',
              // No textOverflow: 'ellipsis'. The granular nameSize picks an
              // appropriate font for the character count, so we shouldn't
              // need to clip — and "Wart..." looks worse than just letting
              // a very long edge-case name extend slightly.
              overflow: 'visible',
            }}>
              {displayName}
            </h1>
            {genus && (
              <div style={{
                fontSize: 19, fontStyle: 'italic',
                color: tc.bgLight,
                marginTop: 8, fontWeight: 700,
                whiteSpace: 'nowrap',
                letterSpacing: 0.5,
                textShadow: '0 1px 3px rgba(0,0,0,0.45)',
              }}>
                The {genus}
              </div>
            )}
          </div>

          {/* Type chips — horizontal flex so single chips don't stretch */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {types.map(t => {
              const ttc = TYPE_COLORS[t] ?? tc
              return (
                <div key={t} style={{
                  background: ttc.bg,
                  color: '#fff',
                  padding: '10px 26px',
                  borderRadius: 999,
                  fontSize: 18, fontWeight: 900,
                  textTransform: 'uppercase', letterSpacing: 2,
                  textAlign: 'center', whiteSpace: 'nowrap',
                  boxShadow: `0 0 18px ${ttc.bg}AA, inset 0 1px 2px rgba(255,255,255,0.40), inset 0 -2px 4px rgba(0,0,0,0.25)`,
                  border: '1px solid rgba(255,255,255,0.22)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.40)',
                }}>
                  {t}
                </div>
              )
            })}
            {isLegendary && (
              <div style={{
                background: GOLD, color: '#3a2900',
                padding: '10px 22px', borderRadius: 999,
                fontSize: 16, fontWeight: 900,
                textTransform: 'uppercase', letterSpacing: 1.6,
                textAlign: 'center', whiteSpace: 'nowrap',
                boxShadow: `0 0 18px ${GOLD}99, inset 0 1px 2px rgba(255,255,255,0.55)`,
                textShadow: 'none',
              }}>
                ★ Legendary
              </div>
            )}
            {isMythical && (
              <div style={{
                background: '#C77DFF', color: '#fff',
                padding: '10px 22px', borderRadius: 999,
                fontSize: 16, fontWeight: 900,
                textTransform: 'uppercase', letterSpacing: 1.6,
                textAlign: 'center', whiteSpace: 'nowrap',
                boxShadow: '0 0 18px rgba(199,125,255,0.65), inset 0 1px 2px rgba(255,255,255,0.32)',
                textShadow: '0 1px 2px rgba(0,0,0,0.35)',
              }}>
                ✦ Mythical
              </div>
            )}
          </div>

          {/* Dex info — packed tight, no more dead space */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}>
            <InfoBlock label="Height"  value={`${heightM}m`} />
            <InfoBlock label="Weight"  value={`${weightKg}kg`} />
            <InfoBlock label="Ability" value={primaryAbility} />
          </div>
        </div>

        {/* RIGHT — empty placeholder; artwork is the floating element above */}
        <div style={{ flex: 1 }} />
      </div>

      {/* COLLECTOR STATS panel — slate, big shadow, faint white border */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '0 52px',
        display: 'flex',
        alignItems: 'center',
      }}>
        <div style={{
          width: '100%',
          background: PANEL_BG,
          border: PANEL_BORDER,
          borderRadius: 22,
          padding: '20px 28px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 16,
          color: '#fff',
          boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
        }}>
          <BigStat big={String(cards.length)}    small="Total Cards"     accent={tc.bgLight} />
          <BigStat big={String(uniqueSetCount)}  small="Sets Featured"   accent={tc.bgLight} />
          <BigStat big={headerStat}              small={headerStatLabel} accent={tc.bgLight} />
        </div>
      </div>

      {/* BATTLE STATS — same panel treatment, type-coloured gradient bars */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '14px 52px 0',
        overflow: 'hidden',
        color: '#fff',
      }}>
        <div style={{
          background: PANEL_BG,
          border: PANEL_BORDER,
          borderRadius: 22,
          padding: '16px 26px 14px',
          boxShadow: '0 8px 20px rgba(0,0,0,0.20)',
          height: '100%',
          boxSizing: 'border-box',
        }}>
          <div style={{
            fontSize: 14, fontWeight: 900, letterSpacing: 3.5,
            color: tc.bgLight,
            marginBottom: 12, textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}>
            Battle Stats <span style={{ opacity: 0.6, fontWeight: 700, color: '#fff' }}>· {totalStats} total</span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: 'repeat(3, 1fr)',
            columnGap: 36,
            rowGap: 8,
            height: 124,
          }}>
            {stats.map((s: any) => (
              <StatBar
                key={s.name}
                name={STAT_LABEL[s.name] ?? s.name}
                value={s.value}
                accentStart={tc.bg}
                accentEnd={tc.bgLight}
              />
            ))}
          </div>
        </div>
      </div>

      {/* FEATURED CARD — slate panel, gold price, big shadow */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '14px 52px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}>
        {featured ? (
          <div style={{
            background: PANEL_BG,
            border: PANEL_BORDER,
            borderRadius: 22,
            padding: '16px 22px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.20)',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            whiteSpace: 'nowrap',
            color: '#fff',
            flex: 1,
          }}>
            {featured.image_url && (
              <img
                crossOrigin="anonymous"
                src={proxyImg(featured.image_url) || ''}
                alt={featured.card_name}
                style={{
                  // 70x96 (down from 88x122) so it fits the panel inner height
                  // and doesn't bleed below the slate boundary.
                  width: 70, height: 96, objectFit: 'contain',
                  borderRadius: 6, flexShrink: 0,
                  background: 'rgba(255,255,255,0.06)',
                  boxShadow: '0 6px 18px rgba(0,0,0,0.40)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{
                fontSize: 13, fontWeight: 900, letterSpacing: 2.5,
                color: tc.bgLight, textTransform: 'uppercase',
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
                color: '#fff',
              }}>
                {featured.card_name}
              </div>
              <div style={{
                fontSize: 16, color: 'rgba(255,255,255,0.75)', marginTop: 5, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {featured.set_name}
              </div>
            </div>
            <div style={{
              // Fixed width so both children right-align to the same edge.
              // paddingRight bumped 4 -> 18 so the price block sits visibly
              // inset from the panel's right edge instead of pressing
              // against it.
              width: 180,
              textAlign: 'right',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              paddingRight: 18,
              boxSizing: 'border-box',
            }}>
              <div style={{
                fontSize: 50, fontWeight: 900,
                fontFamily: "'Outfit', sans-serif", lineHeight: 1,
                color: GOLD,
                letterSpacing: -0.5,
                textShadow: '0 2px 6px rgba(255,216,77,0.35), 0 3px 10px rgba(0,0,0,0.30)',
              }}>
                {fmtPrice(featuredPrice)}
              </div>
              <div style={{
                fontSize: 13, fontWeight: 800, color: GOLD, opacity: 0.92,
                letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 4,
                textShadow: '0 1px 3px rgba(0,0,0,0.4)',
              }}>
                {featuredGrade}
              </div>
            </div>
          </div>
        ) : (
          <div style={{
            background: PANEL_BG,
            border: PANEL_BORDER,
            borderRadius: 22,
            padding: '20px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.20)',
            textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.7)',
            flex: 1,
          }}>
            No card price data yet.
          </div>
        )}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: 700, letterSpacing: 1,
          whiteSpace: 'nowrap',
          marginTop: 10,
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
        fontSize: 11, fontWeight: 900, color: '#fff', opacity: 0.55,
        letterSpacing: 2, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22, fontWeight: 900,
        fontFamily: "'Outfit', sans-serif",
        marginTop: 2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        letterSpacing: -0.3,
        color: '#fff',
      }}>
        {value}
      </div>
    </div>
  )
}

function BigStat({ big, small, accent }: { big: string; small: string; accent: string }) {
  return (
    <div style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <div style={{
        fontSize: 52, fontWeight: 900, lineHeight: 1,
        fontFamily: "'Outfit', sans-serif", letterSpacing: -1.2,
        whiteSpace: 'nowrap',
        color: '#fff',
        textShadow: '0 2px 8px rgba(0,0,0,0.35)',
      }}>
        {big}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 900, letterSpacing: 1.8,
        color: accent, marginTop: 8, textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {small}
      </div>
    </div>
  )
}

function StatBar({ name, value, accentStart, accentEnd }: {
  name: string; value: number; accentStart: string; accentEnd: string
}) {
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
        fontSize: 16, fontWeight: 900, color: '#fff', opacity: 0.92,
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
        color: '#fff',
        textShadow: '0 1px 3px rgba(0,0,0,0.35)',
      }}>
        {value}
      </span>
      <div style={{
        height: 14, background: 'rgba(0,0,0,0.32)',
        borderRadius: 999, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.10)',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: `linear-gradient(90deg, ${accentStart} 0%, ${accentEnd} 100%)`,
          borderRadius: 999,
          boxShadow: `0 0 12px ${accentStart}66`,
        }} />
      </div>
    </div>
  )
}
