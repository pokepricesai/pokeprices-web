'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, formatPrice, formatPct } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'

const upcomingReleases = [
  { name: 'Perfect Order', date: 'Mar 27, 2026', confirmed: true, type: 'Main Set' },
  { name: 'Chaos Rising', date: 'May 22, 2026', confirmed: true, type: 'Main Set' },
  { name: 'Abyss Eye', date: 'Jul 2026 (est)', confirmed: false, type: 'Main Set' },
  { name: 'Celebration Collection', date: 'Nov 2026 (est)', confirmed: false, type: 'Special Set' },
]

const features = [
  { icon: '📊', title: 'Real Sales Data', desc: 'Daily prices from actual completed sales across major marketplaces.' },
  { icon: '💷', title: 'True Landed Cost', desc: 'VAT, shipping, customs, handling — the full picture for UK buyers.' },
  { icon: '📈', title: 'Trend Analysis', desc: '30 days, 6 months, or 5 years. Spot market movement early.' },
  { icon: '💎', title: 'Grading Intelligence', desc: 'Pop counts, grade premiums, and honest UK grading advice.' },
]

const faqs = [
  { q: 'Where does the pricing data come from?', a: 'All prices are sourced from actual completed sales on major marketplaces. We update daily so you always have current market values.' },
  { q: "Is this really free?", a: "Genuinely free. No login, no email capture, no premium tier. Revenue comes from optional affiliate links when you're ready to buy." },
  { q: 'Do you cover UK import costs?', a: 'Yes. We factor in VAT, Royal Mail handling fees, shipping, and customs so you see the true landed cost.' },
  { q: 'What grading companies do you track?', a: 'We track PSA and CGC prices and population data. Our grading advice covers PSA, CGC, BGS, SGC, and ACE.' },
]

interface TrendCard {
  card_slug: string
  card_name: string
  set_name: string
  current_raw: number
  current_psa10: number
  raw_pct_30d: number
  image_url?: string
}

// Sparkle component
function Sparkles() {
  return (
    <>
      {[
        { top: '8%', left: '10%', size: 6, delay: '0s' },
        { top: '15%', right: '15%', size: 8, delay: '0.8s' },
        { top: '25%', left: '20%', size: 5, delay: '1.6s' },
        { top: '12%', right: '30%', size: 7, delay: '0.4s' },
        { top: '30%', left: '5%', size: 4, delay: '1.2s' },
        { top: '20%', right: '8%', size: 6, delay: '2s' },
        { top: '5%', left: '40%', size: 5, delay: '0.6s' },
        { top: '35%', right: '20%', size: 4, delay: '1.4s' },
      ].map((s, i) => (
        <div key={i} style={{
          position: 'absolute', ...s, width: s.size, height: s.size,
          background: 'white',
          clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
          animation: `twinkle 2.5s ease-in-out ${s.delay} infinite`,
          pointerEvents: 'none', opacity: 0.6,
        }} />
      ))}
    </>
  )
}

export default function Home() {
  const nextRelease = new Date('2026-03-27T00:00:00')
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0 })
  const [trending, setTrending] = useState<TrendCard[]>([])

  useEffect(() => {
    const tick = () => {
      const diff = nextRelease.getTime() - Date.now()
      if (diff > 0) {
        setCountdown({
          days: Math.floor(diff / 86400000),
          hours: Math.floor((diff % 86400000) / 3600000),
          mins: Math.floor((diff % 3600000) / 60000),
        })
      }
    }
    tick()
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [])

  // Load trending cards
  useEffect(() => {
    async function loadTrending() {
      const { data } = await supabase
        .from('card_trends')
        .select('card_slug, card_name, set_name, current_raw, current_psa10, raw_pct_30d')
        .not('raw_pct_30d', 'is', null)
        .not('current_raw', 'is', null)
        .gt('current_raw', 5000)
        .order('raw_pct_30d', { ascending: false })
        .limit(6)
      if (data) {
        // Fetch images for these cards
        const slugs = data.map((d: any) => d.card_slug)
        const { data: cardData } = await supabase
          .from('cards')
          .select('card_slug, image_url')
          .in('card_slug', slugs)
        const imageMap: Record<string, string> = {}
        if (cardData) cardData.forEach((c: any) => { if (c.image_url) imageMap[c.card_slug] = c.image_url })
        setTrending(data.map((d: any) => ({ ...d, image_url: imageMap[d.card_slug] })))
      }
    }
    loadTrending()
  }, [])

  return (
    <>
      {/* Hero */}
      <section style={{
        background: 'linear-gradient(170deg, #1a5fad 0%, #3b8fe8 35%, #6ab0f5 60%, #9dcbfa 80%, var(--bg) 100%)',
        padding: '40px 24px 70px',
        position: 'relative', overflow: 'hidden',
      }}>
        <Sparkles />

        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          {/* Logo */}
          <img src="/logo.png" alt="PokePrices" style={{
  height: 120, margin: '0 auto 16px', display: 'block',
            filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.2))',
            animation: 'float 4s ease-in-out infinite',
          }} />

          {/* Trust pills */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            {['100% Free', 'No Login', 'No Data Collection'].map((pill) => (
              <span key={pill} style={{
                background: 'rgba(255,255,255,0.15)', color: '#fff',
                fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
                border: '1px solid rgba(255,255,255,0.2)', letterSpacing: 0.3,
                backdropFilter: 'blur(4px)',
              }}>{pill}</span>
            ))}
          </div>

          <h1 style={{
            fontSize: 38, color: '#fff', margin: '0 0 10px', lineHeight: 1.15,
            textShadow: '0 2px 10px rgba(0,0,0,0.15)',
          }}>
            Know what your cards<br />are <span style={{ color: 'var(--accent)' }}>really</span> worth
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, margin: '0 0 28px', lineHeight: 1.6 }}>
            Real market data for 40,000+ Pokemon cards. Ask anything — prices, trends, grading advice.
          </p>

          <InlineChat />

          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 12 }}>
            Updated daily from actual sold listings
          </p>
        </div>
      </section>

      {/* Trending Cards */}
      {trending.length > 0 && (
        <section style={{ padding: '36px 24px', maxWidth: 960, margin: '0 auto' }}>
          <h2 style={{ fontSize: 24, textAlign: 'center', margin: '0 0 6px' }}>
            Trending Right Now
          </h2>
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 14, margin: '0 0 24px' }}>
            Top movers in the last 30 days
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {trending.map((card, i) => {
              const pct = formatPct(card.raw_pct_30d)
              return (
                <Link
                  key={card.card_slug}
                  href={`/card/${card.card_slug}`}
                  className={`card-hover animate-fade-in-up delay-${i + 1}`}
                  style={{
                    background: 'var(--card)', borderRadius: 14,
                    border: '1px solid var(--border)', padding: 14,
                    textDecoration: 'none', color: 'var(--text)',
                    textAlign: 'center',
                  }}
                >
                  {card.image_url ? (
                    <img src={card.image_url} alt={card.card_name} style={{
                      width: 90, height: 126, objectFit: 'contain', marginBottom: 8,
                      borderRadius: 6,
                    }} loading="lazy" />
                  ) : (
                    <div style={{
                      width: 90, height: 126, background: 'var(--bg)', borderRadius: 6,
                      margin: '0 auto 8px', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 24, color: 'var(--border)',
                    }}>🃏</div>
                  )}
                  <div style={{
                    fontWeight: 700, fontSize: 12, marginBottom: 2, lineHeight: 1.3,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>{card.card_name}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 1 }}>
                    {formatPrice(card.current_raw)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: pct.color }}>
                    {pct.text}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Release Calendar */}
      <section style={{ padding: '20px 24px 40px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{
          background: 'var(--card)', borderRadius: 18,
          border: '1px solid var(--border)', overflow: 'hidden',
          boxShadow: '0 2px 15px rgba(37,99,168,0.06)',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
            padding: '20px 24px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 14,
          }}>
            <div>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 2, margin: '0 0 2px', textTransform: 'uppercase', fontWeight: 700 }}>
                Next Release
              </p>
              <h3 style={{ color: '#fff', fontSize: 22, margin: 0, fontWeight: 800 }}>Perfect Order</h3>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: '2px 0 0' }}>March 27, 2026</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { val: countdown.days, label: 'Days' },
                { val: countdown.hours, label: 'Hrs' },
                { val: countdown.mins, label: 'Min' },
              ].map((t) => (
                <div key={t.label} style={{
                  background: 'rgba(255,255,255,0.1)', borderRadius: 12,
                  padding: '8px 12px', textAlign: 'center', minWidth: 46,
                  border: '1px solid rgba(255,203,5,0.2)',
                }}>
                  <div style={{ color: 'var(--accent)', fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{t.val}</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{t.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '16px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              {upcomingReleases.map((r) => (
                <div key={r.name} style={{
                  padding: '12px 14px', background: 'var(--bg-light)',
                  borderRadius: 12, border: '1px solid var(--border-light)',
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {r.date}
                    {!r.confirmed && (
                      <span style={{
                        background: 'rgba(255,165,0,0.12)', color: '#b8741f',
                        fontSize: 10, padding: '1px 6px', borderRadius: 4,
                        marginLeft: 6, fontWeight: 700,
                      }}>Rumoured</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '16px 24px 44px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ fontSize: 24, textAlign: 'center', margin: '0 0 6px' }}>Built different</h2>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 14, margin: '0 0 28px' }}>
          No login. No paywall. No data collection.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {features.map((f, i) => (
            <div key={f.title} className={`card-hover animate-fade-in-up delay-${i + 1}`} style={{
              background: 'var(--card)', borderRadius: 16, padding: '22px 18px',
              border: '1px solid var(--border)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>{f.icon}</div>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px' }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section style={{
        background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
        padding: '30px 24px',
      }}>
        <div style={{
          maxWidth: 800, margin: '0 auto', display: 'flex',
          justifyContent: 'space-around', flexWrap: 'wrap', gap: 20,
        }}>
          {[
            { val: '40,000+', label: 'Cards Tracked' },
            { val: '156', label: 'Sets Covered' },
            { val: '5+ Years', label: 'Price History' },
            { val: 'Daily', label: 'Price Updates' },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--accent)', fontSize: 26, fontWeight: 900 }}>{s.val}</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2, letterSpacing: 0.5, fontWeight: 700 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: '44px 24px', maxWidth: 680, margin: '0 auto' }}>
        <h2 style={{ fontSize: 24, textAlign: 'center', margin: '0 0 24px' }}>
          Questions collectors ask
        </h2>

        {faqs.map((faq, i) => (
          <details key={i} style={{
            background: 'var(--card)', borderRadius: 14,
            border: '1px solid var(--border)', marginBottom: 8, overflow: 'hidden',
          }}>
            <summary style={{
              padding: '14px 18px', fontSize: 14, fontWeight: 700,
              color: 'var(--text)', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              {faq.q}
              <span style={{ color: 'var(--text-muted)', fontSize: 18, fontWeight: 300, marginLeft: 8 }}>+</span>
            </summary>
            <div style={{ padding: '0 18px 14px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {faq.a}
            </div>
          </details>
        ))}
      </section>
    </>
  )
}
