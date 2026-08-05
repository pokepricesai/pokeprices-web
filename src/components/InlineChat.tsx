// v5 — Block 5A-W-52A.1 structured card context (unambiguous
// identifier naming), explicit-card-switch detection, and
// server-provenance activeCard reconstruction on free-text turns.
// See src/lib/chat/cardContext.ts + chatRequest.ts.
'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { CHAT_ENDPOINT } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import { affiliateWrapEbayUrl } from '@/lib/ebayAffiliate'
import {
  type CardContext,
  type SetContext,
  type QuickActionIntent,
  CARD_QUICK_PROMPTS,
  SET_QUICK_PROMPTS,
  cleanCardName,
  displayQuickActionText,
} from '@/lib/chat/cardContext'
import type { ChatRequestBody, ContextSource } from '@/lib/chat/chatRequest'
import { detectExplicitCardSwitch, KNOWN_SETS as EXPLICIT_SWITCH_SETS } from '@/lib/chat/explicitSwitch'

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const quickQuestions = [
  'How much is a Base Set Charizard?',
  'What grading company should I use?',
  'What cards are going up in price?',
  'When is the next set coming out?',
  'Is Moonbreon a good investment?',
  'Cheapest Pikachu cards',
]

interface Message { role: 'user' | 'assistant'; content: string }

function ChatLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (!href) return <>{children}</>

  // Block 2C: defensive affiliate wrapping for any raw eBay URL the AI
  // emits via ebay_listings.item_web_url. The wrapper collapses exact
  // listings to a precise affiliate search so commission is captured.
  // Returns null when the URL is not an eBay URL or the marketplace
  // campaign id is missing — in either case we render the original URL
  // unchanged.
  const wrap = affiliateWrapEbayUrl(href, {
    placement:       'ai_response',
    pageType:        'ai_assistant',
    sourceComponent: 'inline_chat_link',
  })
  const finalHref = (wrap && wrap.url) ? wrap.url : href
  const isAffiliate = !!(wrap && wrap.url)
  const isEbay      = !!wrap   // any host matched eBay, even if campaign id was missing

  function onClick() {
    if (!isEbay) return
    if (!wrap) return
    trackEvent('ai_ebay_clicked', {
      marketplace:     wrap.marketplace === 'uk' ? 'UK' : 'US',
      intent:          wrap.intent,
      source_component:'inline_chat_link',
    })
    trackEvent('affiliate_click', {
      placement:          'ai_response',
      marketplace:        wrap.marketplace === 'uk' ? 'UK' : 'US',
      intent:             wrap.intent,
      custom_tracking_id: wrap.customTrackingId,
      source_component:   'inline_chat_link',
    })
  }

  return (
    <a
      href={finalHref}
      target="_blank"
      rel={isAffiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}
      onClick={onClick}
      style={{ color: 'var(--primary)', textDecoration: 'underline', fontWeight: 700 }}
    >
      {children}
    </a>
  )
}

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
  'Battle Styles', 'Chilling Reign', 'Evolving Skies',
  'Celebrations', 'Fusion Strike', 'Brilliant Stars', 'Astral Radiance',
  'Pokemon GO', 'Lost Origin', 'Silver Tempest', 'Crown Zenith',
  'Scarlet & Violet', 'Paldea Evolved', 'Obsidian Flames', 'Paradox Rift',
  'Paldean Fates', 'Temporal Forces', 'Twilight Masquerade', 'Shrouded Fable',
  'Stellar Crown', 'Surging Sparks', 'Prismatic Evolutions', 'Journey Together',
]

// Sort longest first so multi-word sets match before substrings.
// Uses the module-level KNOWN_SETS above (needed by linkifyResponse);
// the identical list re-exported from explicitSwitch.ts is the one
// detectExplicitCardSwitch() uses. Keeping both in sync via
// EXPLICIT_SWITCH_SETS === KNOWN_SETS assertion at build time
// would be over-engineered — the tests cover the switch behaviour.
const SETS_SORTED = [...KNOWN_SETS].sort((a, b) => b.length - a.length)
// Assertion at load time so a future edit doesn't quietly drift.
if (EXPLICIT_SWITCH_SETS.length !== KNOWN_SETS.length) {
  console.warn('KNOWN_SETS length mismatch between InlineChat and explicitSwitch — update both.')
}

function linkifyResponse(text: string): string {
  // Track which ranges are already linked to avoid double-linking
  const linked = new Set<string>()
  let result = text

  for (const set of SETS_SORTED) {
    if (linked.has(set)) continue
    // Only match if not already inside a markdown link
    const escaped = set.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(?<!\\[)(?<![/(])\\b(${escaped})\\b(?!\\])(?!\\))`, 'g')
    const url = `/set/${encodeURIComponent(set)}`
    const replaced = result.replace(pattern, (match) => {
      linked.add(set)
      return `[${match}](${url})`
    })
    if (replaced !== result) {
      result = replaced
      linked.add(set)
    }
  }

  return result
}

export default function InlineChat({
  cardContext,
  cardName,
  setContext,
  prefillMessage,
  suggestedPrompts,
}: {
  /**
   * Structured card identity. When present, every message this chat
   * sends carries the same card_context in the request body — the
   * edge function loads the exact record without LLM parsing, and
   * follow-up questions retain identity across turns.
   */
  cardContext?: CardContext | null
  /**
   * Raw card_name for building the visible chat header. The DB stores
   * "Kleavor #86" so the header helper strips the trailing "#NN".
   */
  cardName?: string | null
  /** Structured set identity when the chat is mounted on a set page. */
  setContext?: SetContext | null
  prefillMessage?: string
  /** Optional label overrides for the quick-suggestion pills. */
  suggestedPrompts?: string[]
}) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState(() => 'web-' + Math.random().toString(36).slice(2, 10))
  // Block 5A-W-52A.1 — the active card retains identity across
  // turns. Initialised from the mounted cardContext (card page).
  // Free-text turns that resolve to exactly one card update this
  // from server provenance. Explicit switches (user names a new
  // card mid-conversation) clear it for the resolving turn.
  const [activeCard, setActiveCard] = useState<CardContext | null>(cardContext ?? null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Keep activeCard in sync when the parent remounts with a different
  // card (e.g. Suspense flush on a slug change). Comparison by
  // cardUrlSlug avoids ref-identity churn.
  useEffect(() => {
    if (cardContext?.cardUrlSlug !== activeCard?.cardUrlSlug) {
      setActiveCard(cardContext ?? null)
    }
  }, [cardContext?.cardUrlSlug, activeCard?.cardUrlSlug])

  useEffect(() => {
    if (messages.length > 0) chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  const clearChat = useCallback(() => {
    setMessages([]); setSessionId('web-' + Math.random().toString(36).slice(2, 10)); setInput('')
    setActiveCard(cardContext ?? null)
  }, [cardContext])

  const send = async (visibleText: string, intent: QuickActionIntent | null) => {
    if (!visibleText.trim() || loading) return
    setInput('')
    const userMsg: Message = { role: 'user', content: visibleText }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)
    trackEvent('ai_question_submitted', { source_component: 'inline_chat' })

    // Block 5A-W-52A.1 — explicit card-switch detection. If the
    // user's message clearly names a different card while an
    // activeCard is set, drop the pinned context so the server
    // resolves the newly named card fresh. Pre-routed quick
    // actions are exempt: those come from a button and cannot
    // reference another card.
    const explicitSwitch =
      !intent && activeCard != null && detectExplicitCardSwitch(visibleText, activeCard)
    const outgoingCard: CardContext | null = explicitSwitch ? null : activeCard

    // Block 5A-W-52A.1 — structured request body. The visible
    // `message` is clean text. Identity flows through card_context
    // / set_context / intent — never through free-form bracketed
    // prefixes.
    const contextSource: ContextSource =
      explicitSwitch           ? 'card_switch' :
      intent && activeCard     ? 'card_page' :
      intent && setContext     ? 'set_page' :
      activeCard               ? (messages.length === 0 ? 'card_page' : 'conversation') :
      setContext               ? 'set_page' :
                                 'text'
    const body: ChatRequestBody = {
      message: visibleText,
      session_id: sessionId,
      history: [...messages, userMsg].slice(-10),
      card_context: outgoingCard,
      set_context: setContext ?? null,
      intent: intent ?? null,
      context_source: contextSource,
    }

    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      const rawAnswer = data.answer || 'Sorry, something went wrong.'
      const linkedAnswer = linkifyResponse(rawAnswer)
      trackEvent('ai_response_received', {
        query_type:      typeof data?.query_type === 'string' ? data.query_type : undefined,
        response_status: res.ok ? 'ok' : `http_${res.status}`,
        // Block 5A-W-52A — trust the exact-match flag from the edge
        // function instead of the older card_data_found which could
        // be true even when the wrong card was returned. Only report
        // 'yes' on an exact match.
        card_found:      data?.exact_match_found === true ? 'yes' : 'no',
      })
      // Block 5A-W-52A.1 — server-returned activeCard reconstruction.
      // On a free-text or card_switch turn that resolved to exactly
      // one exact card, pin it as activeCard so follow-ups don't
      // re-parse identity. The provenance shape is defined in
      // src/lib/chat/chatRequest.ts::ChatResponseProvenance.
      if (data?.exact_match_found === true &&
          typeof data.matched_card_url_slug === 'string' &&
          typeof data.matched_set_name === 'string') {
        const nextCard: CardContext = {
          cardRecordId: data.matched_card_record_id ?? null,
          cardUrlSlug: data.matched_card_url_slug,
          priceChartingProductId: data.matched_pc_product_id ?? null,
          cardName: typeof data.matched_card_name === 'string' ? data.matched_card_name : '',
          setName: data.matched_set_name,
          cardNumber: typeof data.matched_card_number === 'string' ? data.matched_card_number : null,
          cardNumberDisplay: typeof data.matched_card_number_display === 'string' ? data.matched_card_number_display : null,
          language: data.matched_language === 'jp' ? 'jp' : 'en',
          variant: typeof data.matched_variant === 'string' ? data.matched_variant : null,
        }
        setActiveCard(nextCard)
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: linkedAnswer }])
    } catch {
      trackEvent('ai_error', { failure_stage: 'network', response_status: 'network_error' })
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, I had trouble connecting. Please try again.' }])
    }
    setLoading(false)
  }

  const sendMessage = (text?: string) => send(text ?? input, null)

  const sendQuickAction = (intent: QuickActionIntent) => {
    // Build a clean natural sentence for the visible bubble; identity
    // flows via structured card_context/set_context alongside intent.
    const visibleText = activeCard
      ? displayQuickActionText(intent, activeCard, cardName ?? '')
      : setContext
      ? displayQuickActionText(intent, {
          cardRecordId: null, cardUrlSlug: '', priceChartingProductId: null,
          cardName: '', setName: setContext.setName,
          cardNumber: null, cardNumberDisplay: null, language: setContext.language,
        }, '')
      : ''
    if (!visibleText) return
    return send(visibleText, intent)
  }

  const quickPromptButtons = suggestedPrompts
    ? suggestedPrompts.map(label => ({ label, intent: null as QuickActionIntent | null }))
    : activeCard
    ? CARD_QUICK_PROMPTS.map(p => ({ label: p.label, intent: p.intent }))
    : setContext
    ? SET_QUICK_PROMPTS.map(p => ({ label: p.label, intent: p.intent }))
    : quickQuestions.map(label => ({ label, intent: null as QuickActionIntent | null }))

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 8,
            background: 'linear-gradient(135deg, #1a5fad, #3b82d6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(26,95,173,0.25)',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 800, fontFamily: "'Figtree', sans-serif" }}>
            {activeCard ? `Ask about ${cleanCardName(cardName)}` : setContext ? `Ask about ${setContext.setName}` : "Collector's AI assistant"}
          </span>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px rgba(39,174,96,0.5)' }} />
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
          {quickPromptButtons.map((q) => (
            <button
              key={q.label}
              onClick={() => q.intent ? sendQuickAction(q.intent) : sendMessage(q.label)}
              style={{
                background: 'var(--bg-light)', border: '1px solid var(--border)',
                borderRadius: 20, padding: '6px 13px', fontSize: 12,
                color: 'var(--text)', cursor: 'pointer', fontWeight: 700,
                transition: 'all 0.15s', fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--primary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-light)'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            >{q.label}</button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: 10, background: 'var(--bg-light)' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder={activeCard ? 'Ask anything about this card…' : setContext ? 'Ask anything about this set…' : 'Ask anything about Pokémon cards…'}
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, color: 'var(--text)', background: 'transparent', fontFamily: 'inherit', fontWeight: 600 }}
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
