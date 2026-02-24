'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
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

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// Parse [text](/card/slug) and [text](/set/name) links in assistant messages
function parseMessageLinks(content: string) {
  const linkRegex = /\[([^\]]+)\]\(\/(?:card|set)\/([^)]+)\)/g
  const parts: (string | { text: string; href: string })[] = []
  let lastIndex = 0
  let match

  while ((match = linkRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }
    parts.push({ text: match[1], href: `/${match[0].includes('/card/') ? 'card' : 'set'}/${match[2]}` })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }
  return parts
}

interface InlineChatProps {
  cardContext?: string
}

export default function InlineChat({ cardContext }: InlineChatProps) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState(() => 'web-' + Math.random().toString(36).slice(2, 10))
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  const clearChat = useCallback(() => {
    setMessages([])
    setSessionId('web-' + Math.random().toString(36).slice(2, 10))
    setInput('')
  }, [])

  const sendMessage = async (text?: string) => {
    const msg = text || input
    if (!msg.trim() || loading) return
    setInput('')

    // Prepend card context on first message if available
    let fullMsg = msg
    if (cardContext && messages.length === 0) {
      fullMsg = `[Context: asking about ${cardContext}] ${msg}`
    }

    const userMsg: Message = { role: 'user', content: msg }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          message: fullMsg,
          session_id: sessionId,
          history: [...messages, userMsg].slice(-10),
        }),
      })
      const data = await res.json()
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.answer || 'Sorry, something went wrong. Try again in a moment.',
      }])
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Sorry, I had trouble connecting. Please try again.',
      }])
    }
    setLoading(false)
  }

  const suggestions = cardContext ? cardQuickQuestions : quickQuestions

  return (
    <div style={{
      background: 'var(--card)', borderRadius: 16,
      boxShadow: '0 8px 40px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06)',
      overflow: 'hidden', textAlign: 'left', maxWidth: 640, margin: '0 auto', width: '100%',
      border: '1px solid var(--border)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-warm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Mini pokeball as online indicator */}
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            background: 'linear-gradient(to bottom, var(--red) 48%, #555 48%, #555 52%, #fff 52%)',
            border: '1.5px solid #555',
            position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'var(--green)', border: '1px solid #555',
            }} />
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
            {cardContext ? `Ask about ${cardContext}` : 'Ask me anything about Pokemon cards'}
          </span>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat} style={{
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 6, padding: '3px 10px', fontSize: 12,
            color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--red)'; e.currentTarget.style.color = 'var(--red)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            New chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{
        padding: 16,
        minHeight: messages.length > 0 ? 100 : 0,
        maxHeight: 420, overflowY: 'auto',
      }}>
        {messages.map((msg, i) => (
          <div key={i} className="animate-fade-in" style={{
            marginBottom: 12, display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div className={msg.role === 'assistant' ? 'chat-message' : ''} style={{
              background: msg.role === 'user' ? 'var(--primary)' : 'var(--bg-warm)',
              color: msg.role === 'user' ? '#fff' : 'var(--text)',
              padding: '10px 15px',
              borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              maxWidth: '85%', fontSize: 14, lineHeight: 1.6,
            }}>
              {msg.role === 'assistant' ? (
                parseMessageLinks(msg.content).map((part, j) =>
                  typeof part === 'string' ? (
                    <span key={j} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>
                  ) : (
                    <Link key={j} href={part.href}>{part.text}</Link>
                  )
                )
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 5, padding: '8px 0', alignItems: 'center' }}>
            {/* Pokeball typing indicator */}
            {[0, 1, 2].map((d) => (
              <div key={d} style={{
                width: 10, height: 10, borderRadius: '50%',
                background: `linear-gradient(to bottom, var(--red) 48%, #888 48%, #888 52%, #eee 52%)`,
                border: '1px solid #888',
                animation: `pokeball-bounce 1.2s ease-in-out ${d * 0.15}s infinite`,
              }} />
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
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 20, padding: '6px 13px', fontSize: 12.5,
              color: 'var(--text)', cursor: 'pointer', fontWeight: 500,
              transition: 'all 0.15s', fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--primary)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.borderColor = 'var(--primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg)';
              e.currentTarget.style.color = 'var(--text)';
              e.currentTarget.style.borderColor = 'var(--border)';
            }}>
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{
        padding: '10px 14px', borderTop: '1px solid var(--border)',
        display: 'flex', gap: 10, background: 'var(--bg-warm)',
      }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Search any Pokemon card or set..."
          style={{
            flex: 1, border: 'none', outline: 'none', fontSize: 14,
            color: 'var(--text)', background: 'transparent', fontFamily: 'inherit',
          }}
        />
        <button onClick={() => sendMessage()} disabled={loading} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 10,
          padding: '8px 18px', fontSize: 14, fontWeight: 600,
          color: 'var(--primary)', cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', opacity: loading ? 0.6 : 1, transition: 'all 0.15s',
        }}>Ask</button>
      </div>
    </div>
  )
}
