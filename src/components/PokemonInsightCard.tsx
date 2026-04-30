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
const PANEL_BG = 'rgba(28, 32, 48, 0.72)'
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

  // Auto-scale display name. ~25% larger than the previous pass overall;
  // long names still shrink so they fit on one line.
  const nameLen = displayName.length
  const nameSize = nameLen > 14 ? 78 : nameLen > 10 ? 100 : 118

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

      {/* Cyan glow halo behind the Pokémon (right side of hero, around y=300) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 130, right: 30,
          width: 480, height: 480,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,200,255,0.30) 0%, rgba(0,200,255,0.10) 35%, transparent 65%)',
          filter: 'blur(40px)',
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

      {/* HERO — type chips + dex info on left, big artwork on right.
          Name + genus span the full width below. */}
      <div style={{
        position: 'relative', zIndex: 2,
        padding: '12px 48px 0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          height: 320,
        }}>
          {/* LEFT — type chips (top) + dex info (bottom), stacked */}
          <div style={{
            width: 260, height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            {/* Type pills */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {types.map(t => {
                const ttc = TYPE_COLORS[t] ?? tc
                return (
                  <div key={t} style={{
                    background: ttc.bg,
                    color: '#fff',
                    padding: '11px 22px',
                    borderRadius: 999,
                    fontSize: 18, fontWeight: 900,
                    textTransform: 'uppercase', letterSpacing: 2,
                    textAlign: 'center', whiteSpace: 'nowrap',
                    boxShadow: `0 0 16px ${ttc.bg}88, inset 0 1px 2px rgba(255,255,255,0.32), inset 0 -2px 4px rgba(0,0,0,0.22)`,
                    border: '1px solid rgba(255,255,255,0.18)',
                    textShadow: '0 1px 2px rgba(0,0,0,0.35)',
                  }}>
                    {t}
                  </div>
                )
              })}
              {isLegendary && (
                <div style={{
                  background: GOLD, color: '#3a2900',
                  padding: '11px 22px', borderRadius: 999,
                  fontSize: 16, fontWeight: 900,
                  textTransform: 'uppercase', letterSpacing: 1.6,
                  textAlign: 'center', whiteSpace: 'nowrap',
                  boxShadow: `0 0 16px ${GOLD}77, inset 0 1px 2px rgba(255,255,255,0.45)`,
                  textShadow: 'none',
                }}>
                  ★ Legendary
                </div>
              )}
              {isMythical && (
                <div style={{
                  background: '#C77DFF', color: '#fff',
                  padding: '11px 22px', borderRadius: 999,
                  fontSize: 16, fontWeight: 900,
                  textTransform: 'uppercase', letterSpacing: 1.6,
                  textAlign: 'center', whiteSpace: 'nowrap',
                  boxShadow: '0 0 16px rgba(199,125,255,0.55), inset 0 1px 2px rgba(255,255,255,0.32)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.35)',
                }}>
                  ✦ Mythical
                </div>
              )}
            </div>

            {/* Dex info — height/weight/ability stacked under chips */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}>
              <InfoBlock label="Height" value={`${heightM}m`} />
              <InfoBlock label="Weight" value={`${weightKg}kg`} />
              <InfoBlock label="Ability" value={primaryAbility} />
            </div>
          </div>

          {/* RIGHT — big artwork. The cyan glow div above sits behind. */}
          <div style={{
            flex: 1,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: 4,
          }}>
            <img
              crossOrigin="anonymous"
              src={artworkUrl}
              alt={displayName}
              style={{
                width: 380, height: 380, objectFit: 'contain',
                filter: 'drop-shadow(0 18px 40px rgba(0,0,0,0.55))',
                display: 'block',
                flexShrink: 0,
              }}
            />
          </div>
        </div>

        {/* Name + genus, centred under the row */}
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <h1 style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: nameSize,
            fontWeight: 900,
            letterSpacing: -2.5,
            margin: 0,
            textTransform: 'capitalize',
            textShadow: '0 4px 18px rgba(0,0,0,0.45), 0 0 1px rgba(0,0,0,0.5)',
            color: '#fff',
            lineHeight: 0.95,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {displayName}
          </h1>
          {genus && (
            <div style={{
              fontSize: 20, fontStyle: 'italic',
              color: '#fff', opacity: 0.7,
              marginTop: 6, fontWeight: 600,
              whiteSpace: 'nowrap',
              textShadow: '0 1px 3px rgba(0,0,0,0.45)',
            }}>
              The {genus}
            </div>
          )}
        </div>
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
                  width: 88, height: 122, objectFit: 'contain',
                  borderRadius: 7, flexShrink: 0,
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
            <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <div style={{
                fontSize: 56, fontWeight: 900,
                fontFamily: "'Outfit', sans-serif", lineHeight: 1,
                color: GOLD,
                letterSpacing: -1.5,
                textShadow: '0 2px 8px rgba(255,216,77,0.40), 0 4px 14px rgba(0,0,0,0.35)',
              }}>
                {fmtPrice(featuredPrice)}
              </div>
              <div style={{
                fontSize: 14, fontWeight: 800, color: GOLD, opacity: 0.92,
                letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 6,
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
