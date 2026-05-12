import type { Metadata } from 'next'
import InlineChat from '@/components/InlineChat'

export const metadata: Metadata = {
  title: "Ask Me Anything — Pokémon TCG AI assistant | PokePrices",
  description: 'Chat with PokePrices, a collector-built AI that knows every card, set and sold price in our database. Free, no login. Ask about grading economics, set context, market trends and more.',
  alternates: { canonical: 'https://www.pokeprices.io/ai-assistant' },
}

const SUGGESTED_PROMPTS = [
  'Is Charizard ex from Obsidian Flames worth grading?',
  'How has the Crown Zenith ETB held up since release?',
  'What is the best long-term investment from Surging Sparks?',
  'Show me the biggest 30-day risers in Modern era',
  'What is the PSA 10 premium on a Base Set Blastoise?',
]

export default function AIAssistantPage() {
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

      {/* Chat */}
      <div style={{ marginBottom: 28 }}>
        <InlineChat suggestedPrompts={SUGGESTED_PROMPTS} />
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
        </ul>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
        AI is a feature, not a brand. The numbers below every answer are what we actually trust.
      </p>
    </div>
  )
}
