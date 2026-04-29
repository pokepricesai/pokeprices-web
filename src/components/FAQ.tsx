// FAQ — visible accordion + schema.org FAQPage JSON-LD in one component.
// Google requires FAQ schema to mirror visible content; this guarantees they stay in sync.

export interface FAQItem {
  question: string
  answer: string
}

export default function FAQ({
  items,
  title = 'Frequently asked questions',
  intro,
}: {
  items: FAQItem[]
  title?: string
  intro?: string
}) {
  if (!items || items.length === 0) return null

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(it => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: it.answer,
      },
    })),
  }

  return (
    <section style={{ margin: '36px 0 24px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <h2 style={{
        fontFamily: "'Outfit', sans-serif",
        fontSize: 22,
        margin: '0 0 6px',
        color: 'var(--text)',
      }}>{title}</h2>
      {intro && (
        <p style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif",
          margin: '0 0 18px',
          lineHeight: 1.6,
        }}>{intro}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: intro ? 0 : 12 }}>
        {items.map((it, i) => (
          <details key={i} style={{
            background: 'var(--card)',
            borderRadius: 12,
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <summary style={{
              padding: '13px 16px',
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--text)',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: "'Figtree', sans-serif",
              listStyle: 'none',
            }}>
              <span style={{ flex: 1, paddingRight: 12 }}>{it.question}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 18, fontWeight: 300, flexShrink: 0 }}>+</span>
            </summary>
            <div style={{
              padding: '0 16px 14px',
              fontSize: 13,
              color: 'var(--text)',
              lineHeight: 1.7,
              fontFamily: "'Figtree', sans-serif",
            }}>{it.answer}</div>
          </details>
        ))}
      </div>
    </section>
  )
}
