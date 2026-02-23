'use client'
import { useState, useRef, useEffect } from 'react'
import { CHAT_ENDPOINT } from '@/lib/supabase'

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

interface InlineChatProps {
  cardContext?: string
}

const defaultQuestions = [
  'How much is a Base Set Charizard?',
  'What grading company should I use?',
  'What cards are going up in price?',
  'When is the next set coming out?',
  'Is Moonbreon a good investment?',
  'Cheapest Pikachu cards',
]

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function InlineChat({ cardContext }: InlineChatProps) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionId] = useState(() => 'web-' + Math.random().toString(36).slice(2, 10))
  const chatEndRef = useRef<HTMLDivElement>(null)

  const quickQuestions = cardContext ? [
    'Should I grade this card?',
    'Is this a good investment?',
    'What is the PSA 10 premium?',
    'How has this card trended?',
  ] : defaultQuestions

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  const sendMessage = async (text?: string) => {
    const msg = text || input
    if (!msg.trim() || loading) return
    setInput('')

    const fullMsg = cardContext && messages.length === 0
      ? msg + ' (Card: ' + cardContext + ')'
      : msg

    const userMsg: Message = { role: 'user', content: msg }
    const apiMsg: Message = { role: 'user', content: fullMsg }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + ANON_KEY,
        },
        body: JSON.stringify({
          message: fullMsg,
          session_id: sessionId,
          history: [...messages, apiMsg].slice(-10),
        }),
      })
      const data = await res.json()
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.answer || 'Sorry, something went wrong. Try again in a moment.',
      }])
    } catch (e) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Sorry, I had trouble connecting. Please try again.',
      }])
    }
    setLoading(false)
  }

  return (
    <div style={{
      background: 'var(--card)', borderRadius: 16,
      boxShadow: '0 8px 40px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)',
      overflow: 'hidden', textAlign: 'left', maxWidth: 640, margin: '0 auto', width: '100%',
    }}>
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)' }} />
        <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
          {cardContext ? 'Ask about ' + cardContext : 'Ask me anything about Pokemon cards'}
        </span>
      </div>

      <div style={{
        padding: 20,
        minHeight: messages.length > 0 ? 120 : 0,
        maxHeight: 400, overflowY: 'auto',
      }}>
        {messages.map(function(msg, i) {
          return (
            <div key={i} className="animate-fade-in" style={{
              marginBottom: 14, display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                background: msg.role === 'user' ? 'var(--primary)' : '#f4f1ec',
                color: msg.role === 'user' ? '#fff' : 'var(--text)',
                padding: '10px 16px',
                borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                maxWidth: '85%', fontSize: 14, lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
            </div>
          );
        })}
        {loading && (
          <div style={{ display: 'flex', gap: 4, padding: '8px 0' }}>
            {[0, 1, 2].map(function(d) {
              return (
                <div key={d} style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--text-muted)', opacity: 0.4,
                  animation: 'bounce 1s ease-in-out ' + (d * 0.15) + 's infinite',
                }} />
              );
            })}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {messages.length === 0 && (
        <div style={{ padding: '0 20px 16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {quickQuestions.map(function(q) {
            return (
              <button key={q} onClick={function() { sendMessage(q); }} style={{
                background: '#f8f5ef', border: '1px solid var(--border)',
                borderRadius: 20, padding: '7px 14px', fontSize: 13,
                color: 'var(--text)', cursor: 'pointer', fontWeight: 500,
                transition: 'all 0.15s', fontFamily: 'inherit',
              }}
              onMouseEnter={function(e) {
                (e.target as HTMLElement).style.background = 'var(--primary)';
                (e.target as HTMLElement).style.color = '#fff';
                (e.target as HTMLElement).style.borderColor = 'var(--primary)';
              }}
              onMouseLeave={function(e) {
                (e.target as HTMLElement).style.background = '#f8f5ef';
                (e.target as HTMLElement).style.color = 'var(--text)';
                (e.target as HTMLElement).style.borderColor = 'var(--border)';
              }}>
                {q}
              </button>
            );
          })}
        </div>
      )}

      <div style={{
        padding: '12px 16px', borderTop: '1px solid var(--border)',
        display: 'flex', gap: 10,
      }}>
        <input
          value={input}
          onChange={function(e) { setInput(e.target.value); }}
          onKeyDown={function(e) { if (e.key === 'Enter') sendMessage(); }}
          placeholder="Search any Pokemon card or set..."
          style={{
            flex: 1, border: 'none', outline: 'none', fontSize: 14,
            color: 'var(--text)', background: 'transparent', fontFamily: 'inherit',
          }}
        />
        <button onClick={function() { sendMessage(); }} disabled={loading} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 10,
          padding: '8px 20px', fontSize: 14, fontWeight: 600,
          color: 'var(--primary)', cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s',
        }}>Ask</button>
      </div>
    </div>
  );
}
