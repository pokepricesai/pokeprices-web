'use client'
import { useState, useEffect } from 'react'
import InlineChat from '@/components/InlineChat'

const upcomingReleases = [
  { name: 'Perfect Order', date: 'Mar 27, 2026', confirmed: true, type: 'Main Set' },
  { name: 'Chaos Rising', date: 'May 22, 2026', confirmed: true, type: 'Main Set' },
  { name: 'Abyss Eye', date: 'Jul 2026 (est)', confirmed: false, type: 'Main Set' },
  { name: 'Celebration Collection', date: 'Nov 2026 (est)', confirmed: false, type: 'Special Set' },
]

const features = [
  { icon: '📊', title: 'Real Market Data', desc: 'Daily prices from actual sold listings. Not guesses, not estimates — real completed sales across major marketplaces.' },
  { icon: '💷', title: 'True Landed Cost', desc: 'We show what you actually pay. VAT, shipping, customs, handling fees — the full picture for UK and EU buyers.' },
  { icon: '📈', title: 'Trend Analysis', desc: 'See how any card has moved over 30 days, 6 months, or 5 years. Spot market movement before the crowd.' },
  { icon: '💎', title: 'Grading Intelligence', desc: 'PSA and CGC pop counts, grade premium ratios, and honest grading advice with real UK middleman costs.' },
]

const faqs = [
  { q: 'Where does the pricing data come from?', a: 'All prices are sourced from actual completed sales on major marketplaces including eBay and TCGPlayer. We update daily so you always have current market values, not stale estimates.' },
  { q: "Is this really free? What's the catch?", a: "Genuinely free. No login, no email capture, no premium tier. We're collectors who got tired of overpaying because pricing tools were either behind paywalls or showed misleading data. Revenue comes from optional affiliate links when you're ready to buy." },
  { q: 'Do you cover UK import costs?', a: 'Yes. We factor in VAT, Royal Mail handling fees, shipping, and customs so you see what a card actually costs to land in the UK — not just the US sticker price.' },
  { q: 'What grading companies do you track?', a: 'We track PSA and CGC prices and population data. Our grading advice covers PSA, CGC, BGS, SGC, and ACE with accurate UK middleman pricing.' },
  { q: 'Can I use this on mobile?', a: 'Absolutely. Just chat like you would with any messaging app. Ask a question, get real data back.' },
]

export default function Home() {
  const nextRelease = new Date('2026-03-27T00:00:00')
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0 })

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

  return (
    <>
      {/* Hero */}
      <section className="pokeball-bg" style={{
        background: 'linear-gradient(175deg, var(--primary) 0%, var(--primary-light) 52%, var(--bg) 52.1%)',
        padding: '44px 24px 76px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Decorative pokeball shapes */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 160, height: 160,
          borderRadius: '50%', border: '3px solid rgba(255,203,5,0.08)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: 80, left: -30, width: 100, height: 100,
          borderRadius: '50%', border: '3px solid rgba(255,255,255,0.04)',
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          {/* Trust pills */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
            {['100% Free', 'No Login Required', 'No Data Collection'].map((pill) => (
              <span key={pill} style={{
                background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)',
                fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 20,
                border: '1px solid rgba(255,255,255,0.12)', letterSpacing: 0.3,
              }}>{pill}</span>
            ))}
          </div>

          <h1 style={{
            fontFamily: "'DM Serif Display', serif", fontSize: 42, color: '#fff',
            margin: '0 0 12px', lineHeight: 1.15,
          }}>
            Know what your cards<br />are <span style={{ color: 'var(--accent)' }}>really</span> worth
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, margin: '0 0 32px', lineHeight: 1.6 }}>
            Real market data for 40,000+ Pokemon cards. Ask anything — prices, trends, grading advice, upcoming releases.
          </p>

          <InlineChat />

          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 14 }}>
            Powered by real market data — updated daily from actual sold listings
          </p>
        </div>
      </section>

      {/* Release Calendar */}
      <section style={{ padding: '44px 24px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{
          background: 'var(--card)', borderRadius: 16,
          border: '1px solid var(--border)', overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            background: 'var(--primary)', padding: '22px 24px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 14,
          }}>
            <div>
              <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: 2, margin: '0 0 3px', textTransform: 'uppercase' }}>
                Next Release
              </p>
              <h3 style={{
                fontFamily: "'DM Serif Display', serif", color: '#fff',
                fontSize: 22, margin: 0,
              }}>Perfect Order</h3>
              <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '3px 0 0' }}>March 27, 2026</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                { val: countdown.days, label: 'Days' },
                { val: countdown.hours, label: 'Hrs' },
                { val: countdown.mins, label: 'Min' },
              ].map((t) => (
                <div key={t.label} style={{
                  background: 'rgba(255,255,255,0.08)', borderRadius: 10,
                  padding: '8px 12px', textAlign: 'center', minWidth: 48,
                  border: '1px solid rgba(255,203,5,0.15)',
                }}>
                  <div style={{ color: 'var(--accent)', fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{t.val}</div>
                  <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 }}>{t.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '18px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              {upcomingReleases.map((r) => (
                <div key={r.name} style={{
                  padding: '12px 14px', background: 'var(--bg)',
                  borderRadius: 10, border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {r.date}
                    {!r.confirmed && (
                      <span style={{
                        background: 'rgba(255,165,0,0.12)', color: '#b8741f',
                        fontSize: 10, padding: '1px 6px', borderRadius: 4,
                        marginLeft: 6, fontWeight: 600,
                      }}>Rumoured</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{r.type}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '20px 24px 48px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 26,
          color: 'var(--text)', textAlign: 'center', margin: '0 0 6px',
        }}>Built different</h2>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 14, margin: '0 0 32px' }}>
          No login. No paywall. No data collection. Just honest pricing.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {features.map((f, i) => (
            <div key={f.title} className={`card-hover animate-fade-in-up delay-${i + 1}`} style={{
              background: 'var(--card)', borderRadius: 14, padding: '24px 20px',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 26, marginBottom: 10 }}>{f.icon}</div>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px', fontFamily: "'DM Sans', sans-serif" }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section style={{
        background: 'var(--primary)', padding: '32px 24px',
        borderTop: '3px solid var(--accent)', borderBottom: '3px solid var(--accent)',
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
              <div style={{
                color: 'var(--accent)', fontSize: 26, fontWeight: 700,
                fontFamily: "'DM Serif Display', serif",
              }}>{s.val}</div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 3, letterSpacing: 0.5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: '48px 24px', maxWidth: 680, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 26,
          color: 'var(--text)', textAlign: 'center', margin: '0 0 28px',
        }}>Questions collectors ask</h2>

        {faqs.map((faq, i) => (
          <details key={i} style={{
            background: 'var(--card)', borderRadius: 12,
            border: '1px solid var(--border)', marginBottom: 8, overflow: 'hidden',
          }}>
            <summary style={{
              padding: '14px 18px', fontSize: 14, fontWeight: 600,
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
