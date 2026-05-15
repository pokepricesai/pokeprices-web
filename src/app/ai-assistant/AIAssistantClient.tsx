'use client'
import { useState } from 'react'
import InlineChat from '@/components/InlineChat'
import CardScanner, { ConfirmedCard } from '@/components/CardScanner'

const SUGGESTED_PROMPTS = [
  'Is Charizard ex from Obsidian Flames worth grading?',
  'How has the Crown Zenith ETB held up since release?',
  'What is the best long-term investment from Surging Sparks?',
  'Show me the biggest 30-day risers in Modern era',
  'What is the PSA 10 premium on a Base Set Blastoise?',
]

export default function AIAssistantClient() {
  const [showScanner, setShowScanner] = useState(false)
  const [scannedCard, setScannedCard] = useState<ConfirmedCard | null>(null)

  // Build the cardContext string that InlineChat already understands.
  // Format mirrors what other card-page chats use so the Haiku system
  // prompt picks it up the same way.
  const cardContext = scannedCard
    ? `${scannedCard.clean_name} | ${scannedCard.set_name} | ${scannedCard.card_number_display ?? ''}`
    : undefined

  function handleConfirmed(card: ConfirmedCard) {
    setScannedCard(card)
    setShowScanner(false)
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '36px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.10)', padding: '4px 12px', borderRadius: 14, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          Free · No login · Built on real PokePrices data
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 36, margin: '0 0 10px', color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Ask Me Anything
        </h1>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 600, margin: '0 auto' }}>
          PokePrices' AI assistant knows every card, set and sold price in our database. Ask about grading economics, set context, market moves, hidden gems — anything a real collector would ask another collector. It cites the cards it talks about so you can verify the numbers.
        </p>
      </div>

      {/* Scan-a-card entry */}
      {!showScanner && !scannedCard && (
        <div style={{
          marginBottom: 20, padding: 14, borderRadius: 12,
          background: 'var(--bg-light)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Outfit', sans-serif" }}>Got a card in hand?</strong>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, padding: '2px 6px', borderRadius: 4, background: 'var(--accent)', color: '#1a3a6b' }}>BETA</span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Scan it with your phone camera or upload a photo. I will identify the card and you can ask anything about it.
            </p>
          </div>
          <button
            onClick={() => setShowScanner(true)}
            style={{
              padding: '10px 16px', borderRadius: 10, border: 'none',
              background: 'var(--primary)', color: '#fff',
              fontFamily: "'Figtree', sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Scan a card
          </button>
        </div>
      )}

      {showScanner && (
        <div style={{ marginBottom: 20 }}>
          <CardScanner
            onCardConfirmed={handleConfirmed}
            onClose={() => setShowScanner(false)}
            ctaLabel="Ask about this card"
          />
        </div>
      )}

      {scannedCard && (
        <div style={{
          marginBottom: 14, padding: 12, borderRadius: 12,
          background: 'var(--card)', border: '1px solid var(--primary)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          {scannedCard.image_url && (
            <img src={scannedCard.image_url} alt={scannedCard.clean_name} style={{ width: 48, borderRadius: 6, flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 13, color: 'var(--text)' }}>{scannedCard.clean_name}</strong>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, padding: '2px 6px', borderRadius: 4, background: 'var(--accent)', color: '#1a3a6b' }}>BETA</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {scannedCard.set_name}{scannedCard.card_number_display ? ` · ${scannedCard.card_number_display}` : ''}
              {scannedCard.variant && scannedCard.variant !== 'regular' && scannedCard.variant !== 'unknown'
                ? ` · ${scannedCard.variant.replace('_', ' ')}` : ''}
            </span>
          </div>
          <button
            onClick={() => { setScannedCard(null); setShowScanner(true) }}
            style={{
              padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)',
              fontFamily: "'Figtree', sans-serif", fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Scan another
          </button>
        </div>
      )}

      {/* Chat */}
      <div style={{ marginBottom: 28 }}>
        <InlineChat
          // Re-mount when the card context changes so the chat resets to
          // focus on the newly scanned card.
          key={scannedCard?.card_slug ?? 'no-context'}
          cardContext={cardContext}
          suggestedPrompts={scannedCard ? undefined : SUGGESTED_PROMPTS}
        />
      </div>

      {/* Honest disclosure */}
      <div style={{
        background: 'var(--bg-light)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '18px 20px', maxWidth: 720, margin: '0 auto',
      }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 8px', color: 'var(--text)' }}>
          How this works (and what it is not)
        </h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <li>Powered by Claude Haiku with read-only access to the PokePrices database — 40,000+ cards, 156+ sets, nightly sold-listing updates.</li>
          <li>Numbers it cites come straight from the same tables that power every other page on the site.</li>
          <li>It is not financial advice. The market moves; do your own work on big-ticket decisions.</li>
          <li>No conversation history is stored against your identity. Each session is anonymous.</li>
          <li>Card scanning is in BETA — accuracy is good for modern cards, improving for vintage and promo. Free tier is 100 scans per month.</li>
        </ul>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
        AI is a feature, not a brand. The numbers below every answer are what we actually trust.
      </p>
    </div>
  )
}
