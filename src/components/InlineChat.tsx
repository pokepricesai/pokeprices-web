// v2
'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { CHAT_ENDPOINT } from '@/lib/supabase'

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const quickQuestions = [
  'How much is a Base Set Charizard?',
  'What grading company should I use?',
  'What cards are going up in price?',
  'When is the next set coming out?',
  'Is Moonbreon a good investment?',
  'Cheapest Pikachu cards',
]

const cardQuickQuestions = [
  'Should I grade this card?',
  'How has the price trended?',
  'What grade is best value?',
  'How far from all-time high?',
]

interface Message { role: 'user' | 'assistant'; content: string }

function ChatLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (!href) return <>{children}</>
  const isInternal = href.startsWith('/') 
  if (isInternal) {
    return (
      <Link href={href} style={{ color: 'var(--primary)', textDecoration: 'underline', fontWeight: 700 }}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline', fontWeight: 700 }}>
      {children}
    </a>
  )
}

// Known sets — used to detect set mentions and linkify them
const KNOWN_SETS = [
  'Base Set', 'Jungle', 'Fossil', 'Team Rocket', 'Neo Genesis', 'Neo Discovery',
  'Neo Revelation', 'Neo Destiny', 'Legendary Collection', 'Expedition',
  'Aquapolis', 'Skyridge', 'EX Ruby & Sapphire', 'EX Sandstorm', 'EX Dragon',
  'EX Team Magma vs Team Aqua', 'EX Hidden Legends', 'EX FireRed & LeafGreen',
  'EX Team Rocket Returns', 'EX Deoxys', 'EX Emerald', 'EX Unseen Forces',
  'EX Delta Species', 'EX Legend Maker', 'EX Holon Phantoms', 'EX Crystal Guardians',
  'EX Dragon Frontiers', 'EX Power Keepers',
  'Diamond & Pearl', 'Mysterious Treasures', 'Secret Wonders', 'Great Encounters',
  'Majestic Dawn', 'Legends Awakened', 'Stormfront',
  'Platinum', 'Rising Rivals', 'Supreme Victors', 'Arceus',
  'HeartGold SoulSilver', 'Unleashed', 'Undaunted', 'Triumphant',
  'Call of Legends', 'Black & White', 'Emerging Powers', 'Noble Victories',
  'Next Destinies', 'Dark Explorers', 'Dragons Exalted', 'Boundaries Crossed',
  'Plasma Storm', 'Plasma Freeze', 'Plasma Blast', 'Legendary Treasures',
  'XY', 'Flashfire', 'Furious Fists', 'Phantom Forces', 'Primal Clash',
  'Roaring Skies', 'Ancient Origins', 'BREAKthrough', 'BREAKpoint',
  'Generations', 'Fates Collide', 'Steam Siege', 'Evolutions',
  'Sun & Moon', 'Guardians Rising', 'Burning Shadows', 'Crimson Invasion',
  'Ultra Prism', 'Forbidden Light', 'Celestial Storm', 'Dragon Majesty',
  'Lost Thunder', 'Team Up', 'Unbroken Bonds', 'Unified Minds',
  'Cosmic Eclipse', 'Hidden Fates', 'Shining Fates',
  'Sword & Shield', 'Rebel Clash', 'Darkness Ablaze', 'Vivid Voltage',
  'Shining Fates', 'Battle Styles', 'Chilling Reign', 'Evolving Skies',
  'Celebrations', 'Fusion Strike', 'Brilliant Stars', 'Astral Radiance',
  'Pokemon GO', 'Lost Origin', 'Silver Tempest', 'Crown Zenith',
  'Scarlet & Violet', 'Paldea Evolved', 'Obsidian Flames', 'Paradox Rift',
  'Paldean Fates', 'Temporal Forces', 'Twilight Masquerade', 'Shrouded Fable',
  'Stellar Crown', 'Surging Sparks', 'Prismatic Evolutions', 'Journey Together',
]

// Sort longest first so multi-word sets match before single words
const SETS_SORTED = [...KNOWN_SETS].sort((a, b) => b.length - a.length)

// Convert set mentions and card+set mentions in AI response to markdown links
function linkifyResponse(text: string): string {
  let result = text

  // Match patterns like "Charizard from Evolving Skies", "Umbreon VMAX (Evolving Skies)"
  // and wrap with markdown link to the set page
  for (const set of SETS_SORTED) {
    const escaped = set.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    
    // "X from [Set]" or "X in [Set]" or "X ([Set])" — link the set name
    const fromPattern = new RegExp(`(from|in|from the|within the|\\()\\s*(${escaped})([^\\w])`, 'gi')
    result = result.replace(fromPattern, (match, pre, setName, post) => {
      const url = `/set/${encodeURIComponent(setName)}`
      return `${pre} [${setName}](${url})${post}`
    })

    // Standalone set name not already in a link
    const standalonePattern = new RegExp(`(?<!\\[)(?<!\\()\\b(${escaped})\\b(?!\\])(?!\\))(?![^[]*\\])`, 'g')
    result = result.replace(standalonePattern, (match) => {
      const url = `/set/${encodeURIComponent(match)}`
      return `[${match}](${url})`
    })
  }

  return result
}

export default function InlineChat({ cardContext, prefillMessage, suggestedPrompts }: {
  cardContext?: string
  prefillMessage?: string
  suggestedPrompts?: string[]
}) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState(() => 'web-' + Math.random().toString(36).slice(2, 10))
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (messages.length > 0) chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  const clearChat = useCallback(() => {
    setMessages([]); setSessionId('web-' + Math.random().toString(36).slice(2, 10)); setInput('')
  }, [])

  const sendMessage = async (text?: string) => {
    const msg = text || input
    if (!msg.trim() || loading) return
    setInput('')
    let fullMsg = msg
    if (cardContext && messages.length === 0) fullMsg = `[Context: asking about ${cardContext}] ${msg}`
    const userMsg: Message = { role: 'user', content: msg }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)
    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ message: fullMsg, session_id: sessionId, history: [...messages, userMsg].slice(-10) }),
      })
      const data = await res.json()
      const rawAnswer = data.answer || 'Sorry, something went wrong.'
      // Linkify set mentions in the response
      const linkedAnswer = linkifyResponse(rawAnswer)
      setMessages((prev) => [...prev, { role: 'assistant', content: linkedAnswer }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, I had trouble connecting. Please try again.' }])
    }
    setLoading(false)
  }

  const suggestions = suggestedPrompts ?? (cardContext ? cardQuickQuestions : quickQuestions)

  return (
    <div style={{
      background: 'var(--card)', borderRadius: 18,
      boxShadow: '0 8px 40px rgba(26,95,173,0.15), 0 2px 6px rgba(26,95,173,0.08)',
      overflow: 'hidden', textAlign: 'left', maxWidth: 640, margin: '0 auto', width: '100%',
      border: '1px solid var(--border)',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid var(--border-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-light)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px rgba(39,174,96,0.4)' }} />
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>
            {cardContext ? `Ask about ${cardContext.split(' | ')[0]}` : 'Ask me anything about Pokemon cards'}
          </span>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 8,
            padding: '3px 10px', fontSize: 12, color: 'var(--text-muted)',
            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
          }}>New chat</button>
        )}
      </div>

      {/* Messages */}
      <div style={{ padding: 16, minHeight: messages.length > 0 ? 100 : 0, maxHeight: 420, overflowY: 'auto' }}>
        {messages.map((msg, i) => (
          <div key={i} className="animate-fade-in" style={{ marginBottom: 12, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div className={msg.role === 'assistant' ? 'chat-message' : ''} style={{
              background: msg.role === 'user' ? 'linear-gradient(135deg, #2563a8, #3b82d6)' : 'var(--bg-light)',
              color: msg.role === 'user' ? '#fff' : 'var(--text)',
              padding: '10px 15px',
              borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              maxWidth: '85%', fontSize: 14, lineHeight: 1.6,
            }}>
              {msg.role === 'assistant' ? (
                <ReactMarkdown components={{
                  a: ({ href, children }) => <ChatLink href={href}>{children}</ChatLink>,
                  p: ({ children }) => <p style={{ margin: '0 0 8px 0' }}>{children}</p>,
                  strong: ({ children }) => <strong style={{ color: 'var(--text)', fontWeight: 800 }}>{children}</strong>,
                  code: ({ children }) => <code style={{ background: 'rgba(0,0,0,0.08)', borderRadius: 4, padding: '1px 5px', fontSize: 13, fontFamily: 'monospace' }}>{children}</code>,
                  ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ul>,
                  ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ol>,
                  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                }}>
                  {msg.content}
                </ReactMarkdown>
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 5, padding: '8px 0' }}>
            {[0, 1, 2].map((d) => (
              <div key={d} style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--primary-light)', opacity: 0.5, animation: `bounce 1.2s ease-in-out ${d * 0.15}s infinite` }} />
            ))}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Quick suggestions */}
      {messages.length === 0 && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {suggestions.map((q) => (
            <button key={q} onClick={() => sendMessage(q)} style={{
              background: 'var(--bg-light)', border: '1px solid var(--border)',
              borderRadius: 20, padding: '6px 13px', fontSize: 12,
              color: 'var(--text)', cursor: 'pointer', fontWeight: 700,
              transition: 'all 0.15s', fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-light)'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            >{q}</button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: 10, background: 'var(--bg-light)' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Ask any questions here..."
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: 'var(--text)', background: 'transparent', fontFamily: 'inherit', fontWeight: 600 }}
        />
        <button onClick={() => sendMessage()} disabled={loading} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 12,
          padding: '8px 20px', fontSize: 14, fontWeight: 800,
          color: 'var(--text)', cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', opacity: loading ? 0.6 : 1,
          boxShadow: '0 2px 8px rgba(255,203,5,0.3)',
        }}>Ask</button>
      </div>
    </div>
  )
}
