'use client'
// Block 5A-W-50A — vendor moderation surface.
//
// Two-layer auth, matching /admin/content-studio:
//   1. sessionStorage password gate (SESSION_KEY='admin_authed'), same
//      key used by /admin, /admin/insights, /admin/content-studio and
//      /admin/newsletter-studio — one login covers all four.
//   2. Supabase Auth Bearer token attached to every /api/admin/vendors
//      call. requireAdmin() on the server verifies the token AND that
//      the caller's email is in ADMIN_ALLOWED_EMAILS.
//
// The AdminSessionBar below is the exact same pattern ContentStudio
// uses: signIn / signOut via supabase.auth.signInWithPassword. Luke's
// existing Content Studio credentials work here unchanged.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pokeprices2024'
const SESSION_KEY    = 'admin_authed'   // shared across all /admin/* tools

type Vendor = {
  id: string
  name: string
  slug: string
  vendor_type: string | null
  city: string | null
  country: string | null
  website: string | null
  ebay_store_url: string | null
  logo_url: string | null
  active: boolean
  verified: boolean
  created_at: string
  updated_at: string
}

type Filter = 'pending' | 'active' | 'all'

async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  } catch { return null }
}

// ── Password gate (matches other /admin/* tools) ─────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) {
      try { sessionStorage.setItem(SESSION_KEY, '1') } catch {}
      onLogin()
    } else { setErr(true); setPw('') }
  }
  return (
    <div style={{ maxWidth: 380, margin: '120px auto', padding: 24, background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)' }}>
      <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>Vendor moderation</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 16px' }}>Admin password required.</p>
      <form onSubmit={submit}>
        <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(false) }} placeholder="Password" autoFocus
          style={{ width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10, border: `1px solid ${err ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' }} />
        {err && <p style={{ fontSize: 12, color: '#ef4444', margin: '8px 0 0' }}>Wrong password.</p>}
        <button type="submit" style={{ width: '100%', marginTop: 12, padding: '10px 14px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Enter</button>
      </form>
    </div>
  )
}

// ── Supabase Auth bar (Bearer token required by /api/admin/vendors) ─
function AdminSessionBar() {
  const [email, setEmail] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const [signinEmail, setSigninEmail] = useState('')
  const [signinPw, setSigninPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setEmail(data.session?.user?.email ?? null)
      setLoaded(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return
      setEmail(session?.user?.email ?? null)
    })
    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [])

  async function handleSignIn() {
    if (!signinEmail.trim() || !signinPw) return
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: signinEmail.trim(), password: signinPw,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setShowSignIn(false); setSigninPw('')
  }
  async function handleSignOut() { await supabase.auth.signOut() }
  if (!loaded) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 14px', borderRadius: 10, marginBottom: 14,
      background: email ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
      border: `1px solid ${email ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
      fontFamily: "'Figtree', sans-serif", fontSize: 12,
    }}>
      <span style={{ fontWeight: 700, color: email ? '#16a34a' : '#b91c1c' }}>
        {email ? `Signed in as ${email}` : 'Not signed in'}
      </span>
      <span style={{ color: 'var(--text-muted)', flex: 1 }}>
        {email
          ? 'Approve / verify / unpublish will be allowed if this email is on ADMIN_ALLOWED_EMAILS.'
          : 'Sign in with your admin Supabase account to moderate vendors.'}
      </span>
      {email
        ? <button onClick={handleSignOut} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Sign out</button>
        : <button onClick={() => setShowSignIn(s => !s)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--primary)', background: 'var(--primary)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{showSignIn ? 'Cancel' : 'Sign in'}</button>}
      {showSignIn && !email && (
        <div style={{ flexBasis: '100%', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <input type="email" autoComplete="email" value={signinEmail} onChange={e => setSigninEmail(e.target.value)} placeholder="admin@email"
            style={{ flex: 1, minWidth: 180, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 13, outline: 'none' }} />
          <input type="password" autoComplete="current-password" value={signinPw} onChange={e => setSigninPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) handleSignIn() }} placeholder="Password"
            style={{ flex: 1, minWidth: 180, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 13, outline: 'none' }} />
          <button onClick={handleSignIn} disabled={busy || !signinEmail.trim() || !signinPw}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {err && <p style={{ flexBasis: '100%', fontSize: 11, color: '#b91c1c', margin: 0 }}>{err}</p>}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────
export default function VendorsAdminClient() {
  const [authed,  setAuthed]  = useState<boolean | null>(null)
  const [vendors, setVendors] = useState<Vendor[] | null>(null)
  const [filter,  setFilter]  = useState<Filter>('pending')
  const [busyId,  setBusyId]  = useState<string | null>(null)
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => {
    // Reflect the shared sessionStorage flag — one admin password
    // login covers /admin, /admin/insights, /admin/content-studio,
    // /admin/newsletter-studio and /admin/vendors.
    try { setAuthed(sessionStorage.getItem(SESSION_KEY) === '1') }
    catch { setAuthed(false) }
  }, [])

  const load = useCallback(async () => {
    setErr(null)
    const token = await getAccessToken()
    if (!token) {
      setErr('Sign in with your Supabase account (the bar above) to load vendors.')
      setVendors([])
      return
    }
    try {
      const r = await fetch('/api/admin/vendors', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr((j?.error as string) || `Load failed (${r.status})`)
        setVendors([])
        return
      }
      setVendors((j.vendors as Vendor[]) || [])
    } catch (e: any) {
      setErr(e?.message || 'Network error')
      setVendors([])
    }
  }, [])

  useEffect(() => {
    if (authed !== true) return
    // Re-run whenever the Supabase Auth session changes (sign in / out).
    const { data: sub } = supabase.auth.onAuthStateChange(() => load())
    load()
    return () => sub.subscription.unsubscribe()
  }, [authed, load])

  async function patchVendor(id: string, update: { active?: boolean; verified?: boolean }) {
    setBusyId(id); setErr(null)
    const token = await getAccessToken()
    if (!token) { setBusyId(null); setErr('Not signed in.'); return }
    try {
      const r = await fetch('/api/admin/vendors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, ...update }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErr((j?.error as string) || `Update failed (${r.status})`)
      else setVendors(prev => prev
        ? prev.map(v => v.id === id ? { ...v, ...(j.vendor as Vendor) } : v)
        : prev)
    } catch (e: any) {
      setErr(e?.message || 'Network error')
    } finally { setBusyId(null) }
  }

  if (authed === null) return null
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />

  const filtered = (vendors ?? []).filter(v =>
    filter === 'all'     ? true :
    filter === 'active'  ? v.active :
    !v.active,
  )

  return (
    <div style={wrap}>
      <div style={topRow}>
        <div>
          <h1 style={h1}>Vendor moderation</h1>
          <p style={subtle}>
            Approve pending applications, toggle verification, or unpublish. Changes
            take effect on <Link href="/vendors" style={linkStyle}>/vendors</Link> immediately.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={btnSecondary}>Refresh</button>
          <Link href="/admin" style={btnSecondary as any}>Back to admin</Link>
        </div>
      </div>

      <AdminSessionBar />

      <div style={{ display: 'flex', gap: 8, margin: '4px 0 20px' }}>
        {(['pending', 'active', 'all'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={filter === f ? btnChipOn : btnChip}>
            {f === 'pending' ? 'Pending (inactive)' : f === 'active' ? 'Active' : 'All'}
          </button>
        ))}
      </div>

      {err && <div style={errorBox} role="alert">{err}</div>}

      {vendors === null && !err ? (
        <p style={subtle}>Loading…</p>
      ) : filtered.length === 0 ? (
        <div style={calm}>No vendors match this filter.</div>
      ) : (
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Type</th>
                <th style={th}>Location</th>
                <th style={th}>Active</th>
                <th style={th}>Verified</th>
                <th style={th}>Created</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{v.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      <Link href={`/vendors/${v.slug}`} style={linkStyle} target="_blank">/vendors/{v.slug} ↗</Link>
                    </div>
                    {v.logo_url && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>logo ✓</div>}
                  </td>
                  <td style={td}>{v.vendor_type || '—'}</td>
                  <td style={td}>{[v.city, v.country].filter(Boolean).join(', ') || '—'}</td>
                  <td style={td}>{v.active ? 'yes' : 'no'}</td>
                  <td style={td}>{v.verified ? 'yes' : 'no'}</td>
                  <td style={td}>{v.created_at.slice(0, 10)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {v.active
                        ? <button disabled={busyId === v.id} onClick={() => patchVendor(v.id, { active: false })} style={btnDanger}  title="Set active=false — vendor disappears from /vendors">Unpublish</button>
                        : <button disabled={busyId === v.id} onClick={() => patchVendor(v.id, { active: true  })} style={btnPrimary} title="Set active=true — vendor appears on /vendors">Approve</button>}
                      {v.verified
                        ? <button disabled={busyId === v.id} onClick={() => patchVendor(v.id, { verified: false })} style={btnSecondary} title="Remove verified badge">Unverify</button>
                        : <button disabled={busyId === v.id} onClick={() => patchVendor(v.id, { verified: true  })} style={btnSecondary} title="Grant verified badge">Verify</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 1160, margin: '0 auto', padding: '32px 24px', fontFamily: "'Figtree', sans-serif" }
const topRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }
const h1: React.CSSProperties = { fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px' }
const subtle: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)', margin: 0 }
const linkStyle: React.CSSProperties = { color: 'var(--primary)', textDecoration: 'none' }
const btnBase: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)' }
const btnPrimary: React.CSSProperties = { ...btnBase, background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' }
const btnSecondary: React.CSSProperties = { ...btnBase, background: 'var(--card)', color: 'var(--text)' }
const btnDanger: React.CSSProperties = { ...btnBase, background: '#fee2e2', color: '#7f1d1d', borderColor: '#fecaca' }
const btnChip: React.CSSProperties = { ...btnSecondary, padding: '6px 14px' }
const btnChipOn: React.CSSProperties = { ...btnPrimary, padding: '6px 14px' }
const errorBox: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', marginBottom: 16, fontSize: 13 }
const calm: React.CSSProperties = { padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }
const tableWrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)' }
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }
