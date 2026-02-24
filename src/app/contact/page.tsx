'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function ContactPage() {
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)

  const handleSubmit = async () => {
    if (!message.trim()) return
    setSending(true)
    await supabase.from('feedback').insert([{
      message: message.trim(),
      email: email.trim() || null,
    }])
    setSent(true)
    setSending(false)
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{
        fontFamily: "'DM Serif Display', serif", fontSize: 32,
        margin: '0 0 8px', color: 'var(--text)',
      }}>Get in touch</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: '0 0 32px', lineHeight: 1.6 }}>
        Found a bug? Got a feature request? Want to say hi? Drop us a message.
        We read everything.
      </p>

      {sent ? (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '40px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
          <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 18, margin: '0 0 8px' }}>
            Message sent
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Thanks for reaching out. We&apos;ll get back to you if needed.
          </p>
        </div>
      ) : (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: 28,
        }}>
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="What's on your mind?"
              style={{
                width: '100%', padding: '12px 14px', fontSize: 14,
                border: '1px solid var(--border)', borderRadius: 10,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'inherit', resize: 'vertical', outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 22 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
              Email <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional, only if you want a reply)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: '100%', padding: '12px 14px', fontSize: 14,
                border: '1px solid var(--border)', borderRadius: 10,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'inherit', outline: 'none',
              }}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!message.trim() || sending}
            style={{
              background: 'var(--accent)', border: 'none', borderRadius: 10,
              padding: '12px 28px', fontSize: 15, fontWeight: 600,
              color: 'var(--primary)', cursor: !message.trim() || sending ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', opacity: !message.trim() || sending ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {sending ? 'Sending...' : 'Send message'}
          </button>
        </div>
      )}
    </div>
  )
}
