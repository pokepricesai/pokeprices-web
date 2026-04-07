'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function ContactPageClient() {
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [newsletter, setNewsletter] = useState(false)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)

  const handleSubmit = async () => {
    if (!message.trim()) return
    setSending(true)

    // Save contact message
    await supabase.from('contact_messages').insert([{
      message: message.trim(),
      email: email.trim() || null,
      newsletter_signup: newsletter,
    }])

    // If they want the newsletter and gave an email, add to newsletter table too
    if (newsletter && email.trim()) {
      await supabase.from('newsletter_signups').upsert([{
        email: email.trim().toLowerCase(),
        source: 'contact_page',
      }], { onConflict: 'email' })
    }

    setSent(true)
    setSending(false)
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{
        fontFamily: "'Outfit', sans-serif", fontSize: 32,
        margin: '0 0 8px', color: 'var(--text)',
      }}>Get in touch</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: '0 0 32px', lineHeight: 1.6, fontFamily: "'Figtree', sans-serif" }}>
        Found a bug? Got a feature request? Want to say hi? Drop us a message. We read everything.
      </p>

      {sent ? (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '40px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
          <h3 style={{ fontFamily: "'Figtree', sans-serif", fontWeight: 700, fontSize: 18, margin: '0 0 8px', color: 'var(--text)' }}>
            Message sent
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", margin: '0 0 6px' }}>
            Thanks for reaching out. We&apos;ll get back to you if needed.
          </p>
          {newsletter && email && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, fontFamily: "'Figtree', sans-serif", margin: 0 }}>
              📬 You&apos;re signed up for the monthly digest.
            </p>
          )}
        </div>
      ) : (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: 28,
        }}>
          {/* Message */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>
              Message
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={5}
              placeholder="What's on your mind?"
              style={{
                width: '100%', padding: '12px 14px', fontSize: 14,
                border: '1px solid var(--border)', borderRadius: 10,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: "'Figtree', sans-serif", resize: 'vertical', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Email */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>
              Email <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional, only if you want a reply)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: '100%', padding: '12px 14px', fontSize: 14,
                border: '1px solid var(--border)', borderRadius: 10,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: "'Figtree', sans-serif", outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Newsletter checkbox */}
          <div
            onClick={() => setNewsletter(n => !n)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
              padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
              background: newsletter ? 'rgba(26,95,173,0.06)' : 'var(--bg-light)',
              border: `1px solid ${newsletter ? 'rgba(26,95,173,0.25)' : 'var(--border)'}`,
              transition: 'all 0.15s',
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              border: `2px solid ${newsletter ? 'var(--primary)' : 'var(--border)'}`,
              background: newsletter ? 'var(--primary)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
              {newsletter && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 1 }}>
                📬 Sign me up for the monthly digest
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                Market moves, hidden gems, grading tips — once a month, no spam
              </div>
            </div>
          </div>

          {/* Warning if newsletter ticked but no email */}
          {newsletter && !email.trim() && (
            <p style={{ fontSize: 12, color: '#f59e0b', fontFamily: "'Figtree', sans-serif", margin: '-16px 0 16px', paddingLeft: 2 }}>
              Add your email above to receive the newsletter
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!message.trim() || sending}
            style={{
              background: 'var(--accent)', border: 'none', borderRadius: 10,
              padding: '12px 28px', fontSize: 15, fontWeight: 700,
              color: 'var(--primary)', cursor: !message.trim() || sending ? 'not-allowed' : 'pointer',
              fontFamily: "'Figtree', sans-serif", opacity: !message.trim() || sending ? 0.5 : 1,
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
