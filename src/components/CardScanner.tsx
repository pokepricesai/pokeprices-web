'use client'
// Reusable card scanner for end-user pages (AI assistant, Portfolio).
//
// UX choices:
//   - Mobile: file input with capture="environment" opens the native camera
//     for a single still. AI Vision sees the foil pattern from one frame,
//     no tilt frame loop needed here.
//   - Desktop: same file input but no capture attribute = file picker.
//     Also supports multi-file for bulk processing of phone-uploaded
//     collection photos.
//   - Default model: AI Vision (Haiku 4.5). After a wrong result, user
//     can tap "Try with OCR instead" to re-run on the same image.
//   - 100 scan / month quota enforced server-side; remaining shown here.
//   - BETA badge visible throughout.
//
// Props:
//   onCardConfirmed   — called when the user taps a candidate to confirm.
//   onClose           — called when user closes the scanner.
//   ctaLabel          — text on the confirm button (e.g. "Add to portfolio",
//                       "Tell me about this card").

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getDeviceId } from '@/lib/deviceId'

const SCAN_FN_SLUG = process.env.NEXT_PUBLIC_SCAN_CARD_FN_SLUG || 'quick-action'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://egidpsrkqvymvioidatc.supabase.co'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SCAN_URL = `${SUPABASE_URL}/functions/v1/${SCAN_FN_SLUG}`

const MAX_LONG_EDGE = 1600
const JPEG_QUALITY = 0.85

type Engine = 'ai_vision' | 'vision_ocr'

export interface ConfirmedCard {
  card_slug: string
  card_name: string
  clean_name: string
  set_name: string
  card_url_slug: string
  image_url: string | null
  card_number_display: string | null
  variant: string | null
}

interface Candidate {
  card_slug: string
  card_name: string
  clean_name: string
  set_name: string
  card_number: string | null
  card_number_display: string | null
  card_url_slug: string
  image_url: string | null
  match_quality?: string
  confidence: number
  number_match?: boolean
  denom_match?: boolean
}

interface ScanResponse {
  scan_log_id: number | null
  candidates: Candidate[]
  parsed: any
  ai_variant?: string | null
  match_error?: string | null
  error?: string
  message?: string
  scans_remaining?: number
}

export default function CardScanner({
  onCardConfirmed,
  onClose,
  ctaLabel = 'Use this card',
}: {
  onCardConfirmed: (card: ConfirmedCard) => void
  onClose?: () => void
  ctaLabel?: string
}) {
  const [stage, setStage] = useState<'idle' | 'scanning' | 'results' | 'limit' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<File[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null)
  const [response, setResponse] = useState<ScanResponse | null>(null)
  const [engine, setEngine] = useState<Engine>('ai_vision')
  const [retriedWithOcr, setRetriedWithOcr] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [scansRemaining, setScansRemaining] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auth + quota lookup on mount.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id ?? null
      setUserId(uid)
      const did = uid ? null : getDeviceId()
      try {
        const { data } = await supabase.rpc('scan_quota_remaining', {
          p_user_id:   uid,
          p_device_id: did,
        }).single()
        if (data) setScansRemaining((data as any).scans_remaining)
      } catch { /* silent — quota display is non-critical */ }
    })()
  }, [])

  function pickFiles() {
    inputRef.current?.click()
  }

  async function handleFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return
    const arr = Array.from(files)
    setQueue(arr)
    setQueueIndex(0)
    setRetriedWithOcr(false)
    await processFile(arr[0], engine)
  }

  async function processFile(file: File, useEngine: Engine) {
    setStage('scanning')
    setError(null)
    setResponse(null)
    try {
      const dataUrl = await downscaleImage(file)
      setCurrentImageUrl(dataUrl)
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      const did = userId ? null : getDeviceId()
      const res = await fetch(SCAN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          image_base64: base64,
          engine: useEngine,
          user_id:   userId,
          device_id: did,
        }),
      })
      let data: any = null
      try { data = await res.json() } catch {}
      if (res.status === 429) {
        setResponse(data as ScanResponse)
        setStage('limit')
        return
      }
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
      }
      setResponse(data as ScanResponse)
      if ((data as ScanResponse).scans_remaining != null) {
        setScansRemaining((data as ScanResponse).scans_remaining!)
      } else if (scansRemaining != null) {
        setScansRemaining(Math.max(0, scansRemaining - 1))
      }
      setStage('results')
    } catch (e: any) {
      setError(e?.message || String(e))
      setStage('error')
    }
  }

  async function retryWithOcr() {
    if (queue.length === 0) return
    setRetriedWithOcr(true)
    setEngine('vision_ocr')
    await processFile(queue[queueIndex], 'vision_ocr')
  }

  async function confirmCandidate(c: Candidate) {
    // Fire-and-forget confirm to log the user's choice.
    if (response?.scan_log_id) {
      const did = userId ? null : getDeviceId()
      fetch(SCAN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          action: 'confirm',
          scan_log_id: response.scan_log_id,
          card_slug: c.card_slug,
          user_id: userId,
          device_id: did,
        }),
      }).catch(() => {})
    }
    onCardConfirmed({
      card_slug: c.card_slug,
      card_name: c.card_name,
      clean_name: c.clean_name,
      set_name: c.set_name,
      card_url_slug: c.card_url_slug,
      image_url: c.image_url,
      card_number_display: c.card_number_display,
      variant: response?.ai_variant ?? null,
    })
    // Move to next in queue or reset.
    if (queueIndex + 1 < queue.length) {
      const nextIdx = queueIndex + 1
      setQueueIndex(nextIdx)
      setRetriedWithOcr(false)
      setEngine('ai_vision')
      await processFile(queue[nextIdx], 'ai_vision')
    } else {
      reset()
    }
  }

  function skipCurrent() {
    if (queueIndex + 1 < queue.length) {
      const nextIdx = queueIndex + 1
      setQueueIndex(nextIdx)
      setRetriedWithOcr(false)
      setEngine('ai_vision')
      processFile(queue[nextIdx], 'ai_vision')
    } else {
      reset()
    }
  }

  function reset() {
    setStage('idle')
    setQueue([])
    setQueueIndex(0)
    setCurrentImageUrl(null)
    setResponse(null)
    setError(null)
    setRetriedWithOcr(false)
    setEngine('ai_vision')
    if (inputRef.current) inputRef.current.value = ''
  }

  const candidates = response?.candidates ?? []
  const queueRemaining = queue.length > 0 ? queue.length - queueIndex - 1 : 0

  return (
    <div style={panelStyle}>
      <Header onClose={onClose} scansRemaining={scansRemaining} />

      {/* Hidden file input — drives every entry point. capture=environment
          opens the camera on mobile, falls through to the file picker on
          desktop. multiple lets desktop users bulk-process. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        // @ts-expect-error capture is valid HTML, not in React typings yet
        capture="environment"
        style={{ display: 'none' }}
        onChange={e => handleFilesChosen(e.target.files)}
      />

      {stage === 'idle' && (
        <IdlePanel onPick={pickFiles} />
      )}

      {stage === 'scanning' && currentImageUrl && (
        <ScanningPanel
          imageUrl={currentImageUrl}
          queueLabel={queue.length > 1 ? `Card ${queueIndex + 1} of ${queue.length}` : null}
        />
      )}

      {stage === 'results' && response && currentImageUrl && (
        <ResultsPanel
          response={response}
          candidates={candidates}
          imageUrl={currentImageUrl}
          queueLabel={queue.length > 1 ? `Card ${queueIndex + 1} of ${queue.length}` : null}
          queueRemaining={queueRemaining}
          ctaLabel={ctaLabel}
          retriedWithOcr={retriedWithOcr}
          onConfirm={confirmCandidate}
          onRetryOcr={retryWithOcr}
          onSkip={skipCurrent}
          onCancel={reset}
        />
      )}

      {stage === 'limit' && response && (
        <LimitPanel message={response.message ?? 'Free tier limit reached this month.'} onClose={reset} />
      )}

      {stage === 'error' && error && (
        <ErrorPanel message={error} onRetry={pickFiles} onClose={reset} />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Header({ onClose, scansRemaining }: { onClose?: () => void; scansRemaining: number | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, color: 'var(--text)' }}>
          Scan a card
        </strong>
        <span style={betaTagStyle}>BETA</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {scansRemaining != null && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            {scansRemaining} scans left this month
          </span>
        )}
        {onClose && (
          <button onClick={onClose} style={iconButtonStyle} aria-label="Close scanner">✕</button>
        )}
      </div>
    </div>
  )
}

function IdlePanel({ onPick }: { onPick: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.55 }}>
        On a phone, tapping the button opens your camera. On a desktop, it opens the file picker — pick one image or many to process in a row.
      </p>
      <button onClick={onPick} style={primaryButtonStyle}>
        Scan or upload card
      </button>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '4px 0 0', lineHeight: 1.5 }}>
        Avoid glare, fill the frame with the card, good lighting helps. Bulk uploads are processed one by one — confirm each match as it appears.
      </p>
    </div>
  )
}

function ScanningPanel({ imageUrl, queueLabel }: { imageUrl: string; queueLabel: string | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <img src={imageUrl} alt="scanning" style={{ width: '100%', maxWidth: 280, borderRadius: 10, opacity: 0.7 }} />
      {queueLabel && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{queueLabel}</span>}
      <span style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
        Reading card...
      </span>
    </div>
  )
}

function ResultsPanel({
  response, candidates, imageUrl, queueLabel, queueRemaining,
  ctaLabel, retriedWithOcr, onConfirm, onRetryOcr, onSkip, onCancel,
}: {
  response: ScanResponse
  candidates: Candidate[]
  imageUrl: string
  queueLabel: string | null
  queueRemaining: number
  ctaLabel: string
  retriedWithOcr: boolean
  onConfirm: (c: Candidate) => void
  onRetryOcr: () => void
  onSkip: () => void
  onCancel: () => void
}) {
  const top = candidates[0]
  const noResults = candidates.length === 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {queueLabel && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {queueLabel}
        </span>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <img src={imageUrl} alt="captured" style={{ width: 80, height: 'auto', borderRadius: 8, flexShrink: 0, alignSelf: 'flex-start' }} />
        <div style={{ flex: 1, fontFamily: "'Figtree', sans-serif", fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {response.parsed?.collector_number ? (
            <>Read <strong style={{ color: 'var(--text)' }}>{response.parsed.collector_number}</strong>{response.parsed?.name ? <> · <strong style={{ color: 'var(--text)' }}>{response.parsed.name}</strong></> : null}.</>
          ) : (
            <>Could not read the collector number clearly.</>
          )}
          {response.ai_variant && response.ai_variant !== 'regular' && response.ai_variant !== 'unknown' && (
            <> Surface looks <strong style={{ color: 'var(--primary)' }}>{String(response.ai_variant).replace('_', ' ')}</strong>.</>
          )}
        </div>
      </div>

      {noResults ? (
        <div style={emptyStateStyle}>
          <p style={{ margin: 0, fontFamily: "'Figtree', sans-serif", fontSize: 13, color: 'var(--text)' }}>
            No matching card found in our database for this scan.
          </p>
          {!retriedWithOcr && (
            <button onClick={onRetryOcr} style={secondaryButtonStyle}>Try OCR mode instead</button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {candidates.slice(0, 5).map((c, i) => (
            <CandidateRow key={c.card_slug + i} c={c} isTop={i === 0} ctaLabel={ctaLabel} onConfirm={() => onConfirm(c)} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
        {!retriedWithOcr && !noResults && top && (
          <button onClick={onRetryOcr} style={linkButtonStyle}>None of these? Try OCR mode</button>
        )}
        {queueRemaining > 0 && (
          <button onClick={onSkip} style={linkButtonStyle}>Skip — next ({queueRemaining})</button>
        )}
        <button onClick={onCancel} style={linkButtonStyle}>Cancel</button>
      </div>
    </div>
  )
}

function CandidateRow({
  c, isTop, ctaLabel, onConfirm,
}: { c: Candidate; isTop: boolean; ctaLabel: string; onConfirm: () => void }) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: 10, borderRadius: 10,
      border: `1px solid ${isTop ? 'var(--primary)' : 'var(--border)'}`,
      background: isTop ? 'rgba(96,165,250,0.06)' : 'var(--bg-light)',
    }}>
      <div style={{ width: 48, flexShrink: 0 }}>
        {c.image_url ? (
          <img src={c.image_url} alt={c.clean_name} style={{ width: '100%', borderRadius: 6, display: 'block' }} />
        ) : (
          <div style={{ width: '100%', aspectRatio: '2.5/3.5', background: 'var(--border)', borderRadius: 6 }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <strong style={{ fontFamily: "'Figtree', sans-serif", fontSize: 13, color: 'var(--text)' }}>{c.clean_name}</strong>
        <span style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11, color: 'var(--text-muted)' }}>
          {c.set_name} · {c.card_number_display || c.card_number}
        </span>
        <button onClick={onConfirm} style={{ ...smallPrimaryButtonStyle, marginTop: 6 }}>
          {ctaLabel}
        </button>
      </div>
    </div>
  )
}

function LimitPanel({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontFamily: "'Figtree', sans-serif", fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
        {message}
      </p>
      <button onClick={onClose} style={secondaryButtonStyle}>Close</button>
    </div>
  )
}

function ErrorPanel({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontFamily: "'Figtree', sans-serif", fontSize: 13, color: '#ef4444', lineHeight: 1.5 }}>
        {message}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onRetry} style={primaryButtonStyle}>Try again</button>
        <button onClick={onClose} style={secondaryButtonStyle}>Close</button>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function downscaleImage(file: File): Promise<string> {
  // Resize on canvas so payloads stay small and Vision is not given more
  // than it needs. Reads orientation EXIF via the browser's auto-handling.
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth * scale)
      const h = Math.round(img.naturalHeight * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas not available'))
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
    }
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = URL.createObjectURL(file)
  })
}

// ── Styles ──────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
}

const betaTagStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, letterSpacing: 1.2,
  padding: '2px 6px', borderRadius: 4,
  background: 'var(--accent)', color: '#1a3a6b',
  fontFamily: "'Figtree', sans-serif",
}

const primaryButtonStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none',
  background: 'var(--primary)', color: '#fff', fontFamily: "'Figtree', sans-serif",
  fontSize: 15, fontWeight: 700, cursor: 'pointer',
}

const smallPrimaryButtonStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '6px 12px', borderRadius: 8, border: 'none',
  background: 'var(--primary)', color: '#fff', fontFamily: "'Figtree', sans-serif",
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
}

const linkButtonStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--primary)',
  fontFamily: "'Figtree', sans-serif", fontSize: 12, fontWeight: 700,
  cursor: 'pointer', padding: '4px 0', textDecoration: 'underline',
}

const iconButtonStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--text-muted)',
  fontSize: 16, cursor: 'pointer', padding: 4, lineHeight: 1,
}

const emptyStateStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10,
  padding: 12, borderRadius: 10, border: '1px dashed var(--border)',
  background: 'var(--bg-light)',
}
