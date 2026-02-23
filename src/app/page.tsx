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
  { icon: '🇬🇧', title: 'True Landed Cost', desc: 'We show what you actually pay. VAT, shipping, customs, handling fees — the full picture for UK and EU buyers.' },
  { icon: '📈', title: 'Trend Analysis', desc: 'See how any card has moved over 30 days, 6 months, or 5 years. Spot risers, fallers, and slow burners before the crowd.' },
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
      <section style={{
        background: 'linear-gradient(175deg, #184B44 0%, #1f5c53 55%, var(--bg) 55.1%)',
        padding: '48px 24px 80px',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          {/* Trust pills */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            {['100% Free', 'No Login Required', 'No Data Collection'].map((pill) => (
              <span key={pill} style={{
                background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)',
                fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 20,
                border: '1px solid rgba(255,255,255,0.15)', letterSpacing: 0.3,
              }}>{pill}</span>
            ))}
          </div>

          <h1 style={{
            fontFamily: "'DM Serif Display', serif", fontSize: 44, color: '#fff',
            margin: '0 0 12px', lineHeight: 1.15,
          }}>
            Know what your cards<br />are <span style={{ color: 'var(--accent)' }}>really</span> worth
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 17, margin: '0 0 36px', lineHeight: 1.6 }}>
            Real market data for 40,000+ Pokemon cards. Ask anything — prices, trends, grading advice, upcoming releases.
          </p>

          <InlineChat />

          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 16 }}>
            Powered by real market data — updated daily from actual sold listings
          </p>
        </div>
      </section>

      {/* Release Calendar */}
      <section style={{ padding: '48px 24px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{
          background: 'var(--card)', borderRadius: 16,
          border: '1px solid var(--border)', overflow: 'hidden',
        }}>
          <div style={{
            background: 'var(--primary)', padding: '24px 28px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 16,
          }}>
            <div>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 2, margin: '0 0 4px', textTransform: 'uppercase' }}>
                Next Release
              </p>
              <h3 style={{
                fontFamily: "'DM Serif Display', serif", color: '#fff',
                fontSize: 24, margin: 0,
              }}>Perfect Order</h3>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: '4px 0 0' }}>March 27, 2026</p>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {[
                { val: countdown.days, label: 'Days' },
                { val: countdown.hours, label: 'Hrs' },
                { val: countdown.mins, label: 'Min' },
              ].map((t) => (
                <div key={t.label} style={{
                  background: 'rgba(255,255,255,0.1)', borderRadius: 10,
                  padding: '10px 14px', textAlign: 'center', minWidth: 52,
                }}>
                  <div style={{ color: 'var(--accent)', fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{t.val}</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 3, textTransform: 'uppercase', letterSpacing: 1 }}>{t.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '20px 28px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {upcomingReleases.map((r) => (
                <div key={r.name} style={{
                  padding: '14px 16px', background: '#faf7f2',
                  borderRadius: 10, border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {r.date}
                    {!r.confirmed && (
                      <span style={{
                        background: 'rgba(232,183,48,0.15)', color: '#b8941f',
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
      <section style={{ padding: '24px 24px 56px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 28,
          color: 'var(--text)', textAlign: 'center', margin: '0 0 8px',
        }}>Built different</h2>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 15, margin: '0 0 36px' }}>
          No login. No paywall. No data collection. Just honest pricing.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {features.map((f) => (
            <div key={f.title} style={{
              background: 'var(--card)', borderRadius: 14, padding: '28px 22px',
              border: '1px solid var(--border)', transition: 'box-shadow 0.2s, transform 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)';
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              (e.currentTarget as HTMLElement).style.transform = 'none';
            }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 8px', fontFamily: "'DM Sans', sans-serif" }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section style={{ background: 'var(--primary)', padding: '36px 24px' }}>
        <div style={{
          maxWidth: 800, margin: '0 auto', display: 'flex',
          justifyContent: 'space-around', flexWrap: 'wrap', gap: 24,
        }}>
          {[
            { val: '40,000+', label: 'Cards Tracked' },
            { val: '156', label: 'Sets Covered' },
            { val: '5+ Years', label: 'Price History' },
            { val: 'Daily', label: 'Price Updates' },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{
                color: 'var(--accent)', fontSize: 28, fontWeight: 700,
                fontFamily: "'DM Serif Display', serif",
              }}>{s.val}</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4, letterSpacing: 0.5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: '56px 24px', maxWidth: 680, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 28,
          color: 'var(--text)', textAlign: 'center', margin: '0 0 32px',
        }}>Questions collectors ask</h2>

        {faqs.map((faq, i) => (
          <details key={i} style={{
            background: 'var(--card)', borderRadius: 12,
            border: '1px solid var(--border)', marginBottom: 10, overflow: 'hidden',
          }}>
            <summary style={{
              padding: '16px 20px', fontSize: 15, fontWeight: 600,
              color: 'var(--text)', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              {faq.q}
              <span style={{ color: 'var(--text-muted)', fontSize: 18, fontWeight: 300 }}>+</span>
            </summary>
            <div style={{ padding: '0 20px 16px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {faq.a}
            </div>
          </details>
        ))}
      </section>
    </>
  )
}
