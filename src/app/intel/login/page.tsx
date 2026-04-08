// src/app/intel/login/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function IntelLoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  function handleLogin() {
    // Set cookie and reload — middleware will validate
    document.cookie = `intel_auth=${password}; path=/; max-age=${60 * 60 * 24 * 30}`
    // Let middleware redirect
    window.location.href = '/intel'
  }

  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 320 }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: '0 0 4px', color: 'var(--text)' }}>Intel</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 24px' }}>Private access only</p>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(false) }}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="Password"
            autoFocus
            style={{ width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10, border: `1px solid ${error ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box', marginBottom: 12, textAlign: 'center', letterSpacing: 4 }}
          />
          {error && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", margin: '0 0 10px' }}>Incorrect password</p>}
          <button onClick={handleLogin}
            style={{ width: '100%', padding: '10px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Enter
          </button>
        </div>
      </div>
    </div>
  )
}
