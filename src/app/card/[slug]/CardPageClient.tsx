# CardPageClient.tsx — two changes needed

## Change 1: Add import (after the existing imports, around line 5-6)

ADD this line after the other imports:
```
import { getSetAssets } from '@/lib/setAssets'
```

---

## Change 2: Replace the breadcrumb + hero header block

FIND this exact block (around line ~220 in the render section):
```tsx
      <Link href={`/set/${encodeURIComponent(card.set_name)}`} style={{
        color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none',
        marginBottom: 8, display: 'inline-block', fontFamily: "'Figtree', sans-serif",
      }}>← {card.set_name}</Link>

      <div style={{ margin: '12px 0 28px' }}>
        <InlineChat cardContext={`${card.card_name} from ${card.set_name}`} prefillMessage={prefillMessage} />
      </div>

      {/* ── Hero: image + core data ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 auto' }}>
          {card.image_url ? (
            <img src={card.image_url} alt={card.card_name} style={{
              width: 220, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            }} />
          ) : (
            <div style={{
              width: 220, height: 308, background: 'var(--bg)', borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 40, border: '1px solid var(--border)',
            }}>🃏</div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{
            fontFamily: "'Playfair Display', serif", fontSize: 26,
            margin: '0 0 4px', color: 'var(--text)', letterSpacing: '-0.3px',
          }}>{card.card_name}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 16px', fontFamily: "'Figtree', sans-serif" }}>
            {card.set_name}{card.card_number ? ` · #${card.card_number}` : ''}
          </p>
```

REPLACE WITH:
```tsx
      {/* ── Breadcrumb with set assets ── */}
      {(() => {
        const { logoUrl, symbolUrl } = getSetAssets(card.set_name)
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <Link href={`/set/${encodeURIComponent(card.set_name)}`} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'var(--text-muted)', fontSize: 13, fontFamily: "'Figtree', sans-serif', padding: '5px 10px 5px 6px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, transition: 'border-color 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--primary)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)' }}>
              {logoUrl
                ? <img src={logoUrl} alt={card.set_name} style={{ height: 20, width: 'auto', objectFit: 'contain', maxWidth: 80 }} loading="lazy" />
                : <span>←</span>}
              {symbolUrl && <img src={symbolUrl} alt="" style={{ width: 16, height: 16, objectFit: 'contain' }} loading="lazy" />}
              <span>{card.set_name}</span>
            </Link>
          </div>
        )
      })()}

      <div style={{ margin: '0 0 28px' }}>
        <InlineChat cardContext={`${card.card_name} from ${card.set_name}`} prefillMessage={prefillMessage} />
      </div>

      {/* ── Hero: image + core data ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 auto' }}>
          {card.image_url ? (
            <img src={card.image_url} alt={card.card_name} style={{
              width: 220, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            }} />
          ) : (
            <div style={{
              width: 220, height: 308, background: 'var(--bg)', borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 40, border: '1px solid var(--border)',
            }}>🃏</div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{
            fontFamily: "'Playfair Display', serif", fontSize: 26,
            margin: '0 0 4px', color: 'var(--text)', letterSpacing: '-0.3px',
          }}>{card.card_name}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 16px', fontFamily: "'Figtree', sans-serif" }}>
            {card.set_name}{card.card_number ? ` · #${card.card_number}` : ''}
          </p>
```
