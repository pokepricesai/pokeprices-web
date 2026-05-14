'use client'
// Diagnostic UI for /scan-test. Mobile-first.
// Layout is intentionally utilitarian — every parsed signal, the raw
// Vision text, and the top 5 DB matches are all visible at once so we can
// see which stage of the pipeline failed when a recognition misses.

import { useEffect, useRef, useState } from 'react'

// Supabase assigns a random slug to dashboard-created functions — the
// scan-card function lives at /functions/v1/quick-action. Override with
// NEXT_PUBLIC_SCAN_CARD_FN_SLUG if redeployed under a different slug.
const SCAN_FN_SLUG = process.env.NEXT_PUBLIC_SCAN_CARD_FN_SLUG || 'quick-action'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://egidpsrkqvymvioidatc.supabase.co'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SCAN_URL = `${SUPABASE_URL}/functions/v1/${SCAN_FN_SLUG}`

const MAX_LONG_EDGE = 1600
const JPEG_QUALITY = 0.85
// Mirror of the overlay rect (see CardOverlay) so the capture step can crop
// to roughly the same region the user framed against. Smaller, focused
// payload + Vision stops trying to read background text.
const PREVIEW_CONTAINER_ASPECT = 3 / 4   // width / height
const OVERLAY_WIDTH_PCT = 0.78           // of container width
const CARD_ASPECT = 3.5 / 2.5            // height / width
const CROP_PADDING_PCT = 0.06            // pad each edge so we do not clip the printed border

type Stage = 'idle' | 'starting' | 'live' | 'captured' | 'scanning' | 'result' | 'error'
type Feature = 'DOCUMENT_TEXT_DETECTION' | 'TEXT_DETECTION'

type MatchQuality = 'full' | 'with_denom' | 'numerator' | 'name_only'

interface Candidate {
  card_slug: string
  card_name: string
  clean_name: string
  set_name: string
  card_number: string | null
  card_number_display: string | null
  set_printed_total?: string | null
  card_url_slug: string
  image_url: string | null
  match_quality?: MatchQuality
  number_match: boolean
  denom_match?: boolean
  name_similarity: number
  set_match: boolean
  year_match?: boolean
  pool_size?: number
  rank_in_pool?: number
  confidence: number
}

interface ScanResult {
  scan_log_id: number | null
  feature_used: Feature
  vision: { full_text: string; word_count: number }
  parsed: {
    collector_number: string | null
    collector_number_pattern: string | null
    name: string | null
    set_hint: string | null
    set_abbreviation: string | null
    copyright_year: number | null
    full_text: string
  }
  candidates: Candidate[]
  match_error: string | null
  timing_ms: { vision: number; parse: number; match: number; log?: number; total: number }
}

export default function ScanTestClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [feature, setFeature] = useState<Feature>('DOCUMENT_TEXT_DETECTION')
  const [showRawText, setShowRawText] = useState(false)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  useEffect(() => {
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  async function startCamera() {
    setError(null)
    setStage('starting')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support camera access. Try Safari or Chrome on a phone.')
      setStage('error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setStage('live')
    } catch (e: any) {
      const msg = String(e?.name || e?.message || e)
      if (/NotAllowed|Permission/i.test(msg)) {
        setError('Camera permission denied. Allow camera access for this site in your browser settings.')
      } else if (/NotFound|Devices/i.test(msg)) {
        setError('No camera found on this device.')
      } else if (/Insecure|secure/i.test(msg)) {
        setError('Camera APIs need HTTPS. This works on the deployed Vercel URL but not on localhost over plain http.')
      } else {
        setError(`Camera error: ${msg}`)
      }
      setStage('error')
    }
  }

  async function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const vw = video.videoWidth, vh = video.videoHeight

    // Smart crop: figure out where the on-screen card overlay maps to in
    // native video pixels, then crop to just that region (plus padding).
    // The preview uses object-fit:cover into a container with aspect
    // PREVIEW_CONTAINER_ASPECT, so part of the native video is cropped
    // out of view — we need to undo that to find the visible region.
    const videoAspect = vw / vh
    let visibleW: number, visibleH: number, visibleX: number, visibleY: number
    if (videoAspect > PREVIEW_CONTAINER_ASPECT) {
      visibleH = vh
      visibleW = vh * PREVIEW_CONTAINER_ASPECT
      visibleX = (vw - visibleW) / 2
      visibleY = 0
    } else {
      visibleW = vw
      visibleH = vw / PREVIEW_CONTAINER_ASPECT
      visibleX = 0
      visibleY = (vh - visibleH) / 2
    }

    const cardW = visibleW * OVERLAY_WIDTH_PCT
    const cardH = cardW * CARD_ASPECT
    const cardX = visibleX + (visibleW - cardW) / 2
    const cardY = visibleY + (visibleH - cardH) / 2

    const padX = cardW * CROP_PADDING_PCT
    const padY = cardH * CROP_PADDING_PCT
    const srcX = Math.max(0, cardX - padX)
    const srcY = Math.max(0, cardY - padY)
    const srcW = Math.min(vw - srcX, cardW + padX * 2)
    const srcH = Math.min(vh - srcY, cardH + padY * 2)

    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(srcW, srcH))
    const dstW = Math.round(srcW * scale)
    const dstH = Math.round(srcH * scale)

    const canvas = document.createElement('canvas')
    canvas.width = dstW; canvas.height = dstH
    const ctx = canvas.getContext('2d')
    if (!ctx) { setError('Canvas not available'); setStage('error'); return }
    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH)
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    setCapturedDataUrl(dataUrl)
    stopCamera()
    setStage('captured')
  }

  async function confirmTopCandidate(candidate: Candidate) {
    if (!result?.scan_log_id) {
      setConfirmError('No scan_log_id from server — confirm not available')
      return
    }
    setConfirmError(null)
    try {
      const res = await fetch(SCAN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          action: 'confirm',
          scan_log_id: result.scan_log_id,
          card_slug: candidate.card_slug,
        }),
      })
      let data: any = null
      try { data = await res.json() } catch {}
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setConfirmed(candidate.card_slug)
    } catch (e: any) {
      setConfirmError(e?.message || String(e))
    }
  }

  async function sendScan() {
    if (!capturedDataUrl) return
    setStage('scanning')
    setError(null)
    setResult(null)
    try {
      const base64 = capturedDataUrl.replace(/^data:image\/\w+;base64,/, '')
      const res = await fetch(SCAN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ image_base64: base64, feature }),
      })
      let data: any = null
      try { data = await res.json() } catch {}
      if (!res.ok) {
        const detail = data?.error || `HTTP ${res.status}`
        throw new Error(detail)
      }
      setResult(data as ScanResult)
      setStage('result')
    } catch (e: any) {
      setError(`Scan failed: ${e?.message || e}. URL: ${SCAN_URL}`)
      setStage('error')
    }
  }

  function reset() {
    setCapturedDataUrl(null)
    setResult(null)
    setError(null)
    setShowRawText(false)
    setConfirmed(null)
    setConfirmError(null)
    setStage('idle')
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 80px', color: 'var(--text)' }}>
      <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 24, margin: '0 0 4px' }}>
        Scan Test
      </h1>
      <p style={{ fontFamily: "'Figtree', sans-serif", fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>
        Internal recognition test harness. Capture a card, see what Vision read, what we parsed, and how the database matched.
      </p>

      {stage === 'idle' && (
        <StartPanel onStart={startCamera} />
      )}

      {stage === 'starting' && (
        <Centered>Starting camera...</Centered>
      )}

      {(stage === 'live' || stage === 'starting') && (
        <LivePanel
          videoRef={videoRef}
          onCapture={capture}
          ready={stage === 'live'}
        />
      )}

      {stage === 'captured' && capturedDataUrl && (
        <CapturedPanel
          dataUrl={capturedDataUrl}
          feature={feature}
          onFeatureChange={setFeature}
          onSend={sendScan}
          onRetake={() => { setCapturedDataUrl(null); startCamera() }}
        />
      )}

      {stage === 'scanning' && (
        <Centered>Reading card...</Centered>
      )}

      {stage === 'error' && error && (
        <ErrorPanel message={error} onReset={reset} />
      )}

      {stage === 'result' && result && capturedDataUrl && (
        <ResultPanel
          result={result}
          capturedDataUrl={capturedDataUrl}
          showRawText={showRawText}
          onToggleRawText={() => setShowRawText(v => !v)}
          onReset={reset}
          confirmed={confirmed}
          confirmError={confirmError}
          onConfirm={confirmTopCandidate}
        />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StartPanel({ onStart }: { onStart: () => void }) {
  return (
    <div style={panelStyle}>
      <p style={{ fontFamily: "'Figtree', sans-serif", fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
        Fill the frame with the card, avoid glare, good lighting helps. Hold the camera steady and parallel to the card.
      </p>
      <button onClick={onStart} style={primaryButtonStyle}>Start camera</button>
      <p style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 0' }}>
        Mobile web camera APIs need HTTPS — works on the Vercel deploy but not on localhost.
      </p>
    </div>
  )
}

function LivePanel({
  videoRef, onCapture, ready,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  onCapture: () => void
  ready: boolean
}) {
  return (
    <div style={panelStyle}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '3 / 4', background: '#000', borderRadius: 12, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <CardOverlay />
      </div>
      <button onClick={onCapture} disabled={!ready} style={{ ...primaryButtonStyle, marginTop: 16, opacity: ready ? 1 : 0.5 }}>
        {ready ? 'Capture' : 'Loading...'}
      </button>
    </div>
  )
}

// 2.5:3.5 standard TCG card aspect ratio overlay
function CardOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '78%', aspectRatio: '2.5 / 3.5',
        border: '2px dashed rgba(255,255,255,0.85)',
        borderRadius: 12,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
      }} />
    </div>
  )
}

function CapturedPanel({
  dataUrl, feature, onFeatureChange, onSend, onRetake,
}: {
  dataUrl: string
  feature: Feature
  onFeatureChange: (f: Feature) => void
  onSend: () => void
  onRetake: () => void
}) {
  return (
    <div style={panelStyle}>
      <img src={dataUrl} alt="captured" style={{ width: '100%', borderRadius: 12, display: 'block' }} />
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={smallLabelStyle}>Vision feature</label>
        <select
          value={feature}
          onChange={e => onFeatureChange(e.target.value as Feature)}
          style={selectStyle}
        >
          <option value="DOCUMENT_TEXT_DETECTION">DOCUMENT_TEXT_DETECTION (default — preserves layout)</option>
          <option value="TEXT_DETECTION">TEXT_DETECTION (looser, sometimes catches stylised text)</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onRetake} style={secondaryButtonStyle}>Retake</button>
        <button onClick={onSend} style={primaryButtonStyle}>Recognise</button>
      </div>
    </div>
  )
}

function ErrorPanel({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div style={{ ...panelStyle, borderColor: '#ef4444' }}>
      <p style={{ fontFamily: "'Figtree', sans-serif", fontSize: 14, color: '#ef4444', margin: '0 0 12px' }}>{message}</p>
      <button onClick={onReset} style={secondaryButtonStyle}>Start over</button>
    </div>
  )
}

function ResultPanel({
  result, capturedDataUrl, showRawText, onToggleRawText, onReset,
  confirmed, confirmError, onConfirm,
}: {
  result: ScanResult
  capturedDataUrl: string
  showRawText: boolean
  onToggleRawText: () => void
  onReset: () => void
  confirmed: string | null
  confirmError: string | null
  onConfirm: (c: Candidate) => void
}) {
  const p = result.parsed
  const noText = !p.full_text || p.full_text.trim().length === 0
  const top = result.candidates[0]
  const variantNote = (() => {
    if (!top) return null
    if (top.match_quality === 'full' || top.match_quality === 'with_denom') {
      if ((top.pool_size ?? 1) > 1) {
        return `${top.pool_size} variants of this exact card (regular / reverse holo / etc) — confirm below.`
      }
      return null
    }
    if (top.match_quality === 'numerator') {
      return `No denominator match in DB — these are cards numbered ${p.collector_number?.split('/')[0] || '?'} across different sets. Pick the right one or skip.`
    }
    return null
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={panelStyle}>
        <SectionTitle>Captured image</SectionTitle>
        <img src={capturedDataUrl} alt="captured" style={{ width: '100%', borderRadius: 10, display: 'block', marginTop: 8 }} />
      </div>

      <div style={panelStyle}>
        <SectionTitle>Timing</SectionTitle>
        <div style={statsRowStyle}>
          <Stat label="Vision" value={`${result.timing_ms.vision} ms`} />
          <Stat label="Parse"  value={`${result.timing_ms.parse} ms`} />
          <Stat label="Match"  value={`${result.timing_ms.match} ms`} />
          <Stat label="Total"  value={`${result.timing_ms.total} ms`} />
        </div>
        <div style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          Feature: {result.feature_used} · {result.vision.word_count} words detected
        </div>
      </div>

      <div style={panelStyle}>
        <SectionTitle>Parsed signals</SectionTitle>
        {noText ? (
          <p style={mutedNoteStyle}>Vision detected no text on this image. Try better lighting or a closer crop.</p>
        ) : null}
        <SignalRow label="Collector number" value={p.collector_number} extra={p.collector_number_pattern ? `(${p.collector_number_pattern})` : null} />
        <SignalRow label="Card name" value={p.name} />
        <SignalRow label="Set abbreviation" value={p.set_abbreviation} />
        <SignalRow label="Set hint" value={p.set_hint} />
        <SignalRow label="Copyright year" value={p.copyright_year != null ? String(p.copyright_year) : null} />
      </div>

      <div style={panelStyle}>
        <SectionTitle>
          Raw Vision output
          <button onClick={onToggleRawText} style={linkButtonStyle}>{showRawText ? 'Hide' : 'Show'}</button>
        </SectionTitle>
        {showRawText && (
          <pre style={preStyle}>{p.full_text || '(empty)'}</pre>
        )}
      </div>

      <div style={panelStyle}>
        <SectionTitle>
          Top {result.candidates.length} match{result.candidates.length === 1 ? '' : 'es'}
        </SectionTitle>
        {variantNote && (
          <p style={{ ...mutedNoteStyle, fontWeight: 700, color: 'var(--text)' }}>{variantNote}</p>
        )}
        {result.match_error && (
          <p style={{ ...mutedNoteStyle, color: '#ef4444' }}>Match error: {result.match_error}</p>
        )}
        {result.candidates.length === 0 && !result.match_error && (
          <p style={mutedNoteStyle}>
            {p.collector_number || p.name
              ? 'No matches found for these signals.'
              : 'No signals extracted — nothing to match against.'}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {result.candidates.map((c, i) => (
            <CandidateCard
              key={c.card_slug + i}
              c={c}
              rank={i + 1}
              displayConfidence={displayConfidenceFor(result.candidates, i)}
              confirmed={confirmed === c.card_slug}
              onConfirm={() => onConfirm(c)}
            />
          ))}
        </div>
        {confirmed && (
          <p style={{ ...mutedNoteStyle, color: 'var(--green)' }}>
            Logged — thanks. This scan is now a training-data row for tuning.
          </p>
        )}
        {confirmError && (
          <p style={{ ...mutedNoteStyle, color: '#ef4444' }}>Confirm failed: {confirmError}</p>
        )}
      </div>

      <button onClick={onReset} style={primaryButtonStyle}>Scan another</button>
    </div>
  )
}

// Uniqueness boost: if the top candidate scores meaningfully above #2,
// nudge its displayed confidence up. Rationale — when number+name both
// match for exactly one card and the next-best is much weaker, that is a
// near-certain pick even if neither raw signal hit 1.0.
function displayConfidenceFor(cands: Candidate[], i: number): number {
  const c = cands[i]
  if (i !== 0 || cands.length < 2) return c.confidence
  const gap = c.confidence - cands[1].confidence
  if (gap >= 0.20) return Math.min(1.0, c.confidence + 0.06)
  if (gap >= 0.10) return Math.min(1.0, c.confidence + 0.03)
  return c.confidence
}

function confidenceLabel(conf: number): { text: string; color: string } {
  if (conf >= 0.85) return { text: 'Very confident', color: 'var(--green)' }
  if (conf >= 0.65) return { text: 'Likely',         color: 'var(--primary)' }
  if (conf >= 0.45) return { text: 'Possible',       color: 'var(--text-muted)' }
  return                   { text: 'Unsure',         color: '#ef4444' }
}

function CandidateCard({
  c, rank, displayConfidence, confirmed, onConfirm,
}: {
  c: Candidate; rank: number; displayConfidence: number
  confirmed: boolean; onConfirm: () => void
}) {
  const isTop = rank === 1
  const conf = Math.round(displayConfidence * 100)
  const label = confidenceLabel(displayConfidence)
  const cardSlugPart = (c.card_url_slug || c.card_slug || '').replace(/^pc-/, '')
  const href = c.set_name
    ? `/set/${encodeURIComponent(c.set_name)}/card/${cardSlugPart}`
    : '#'
  return (
    <div
      style={{
        display: 'flex', gap: 12, padding: 10, borderRadius: 10,
        border: `1px solid ${confirmed ? 'var(--green)' : (isTop ? label.color : 'var(--border)')}`,
        background: confirmed ? 'rgba(34, 197, 94, 0.08)' : (isTop ? 'rgba(96, 165, 250, 0.06)' : 'var(--bg-light)'),
        color: 'var(--text)',
      }}
    >
      <a href={href} target="_blank" rel="noopener" style={{ width: 60, flexShrink: 0 }}>
        {c.image_url
          ? <img src={c.image_url} alt={c.clean_name} style={{ width: '100%', borderRadius: 6, display: 'block' }} />
          : <div style={{ width: '100%', aspectRatio: '2.5/3.5', background: 'var(--border)', borderRadius: 6 }} />}
      </a>
      <div style={{ flex: 1, minWidth: 0, fontFamily: "'Figtree', sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
          <a href={href} target="_blank" rel="noopener" style={{ textDecoration: 'none', color: 'var(--text)' }}>
            <strong style={{ fontSize: 14 }}>#{rank} {c.clean_name}</strong>
          </a>
          <span style={{ fontSize: 12, color: label.color, fontWeight: 700 }}>{conf}%</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {c.set_name}
          {' · '}
          {c.card_number_display || (c.card_number && c.set_printed_total ? `${c.card_number}/${c.set_printed_total}` : c.card_number)}
          {(c.pool_size ?? 1) > 1 && (c.match_quality === 'full' || c.match_quality === 'with_denom')
            ? ` · variant ${c.rank_in_pool} of ${c.pool_size}` : ''}
        </div>
        <div style={{ fontSize: 11, marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {isTop && (
            <span style={{ color: label.color, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {label.text}
            </span>
          )}
          <QualityTag q={c.match_quality} />
          <Tag on={c.number_match} label="num" />
          <Tag on={!!c.denom_match} label={c.set_printed_total ? `/${c.set_printed_total}` : '/?'} />
          <Tag on={c.set_match} label="set" />
          <Tag on={!!c.year_match} label="year" />
          <Tag on={c.name_similarity >= 0.5} label={`name ${c.name_similarity.toFixed(2)}`} />
        </div>
        <button
          onClick={onConfirm}
          disabled={confirmed}
          style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            border: confirmed ? '1px solid var(--green)' : '1px solid var(--border)',
            background: confirmed ? 'var(--green)' : 'transparent',
            color: confirmed ? '#fff' : 'var(--text)',
            fontFamily: "'Figtree', sans-serif", fontSize: 12, fontWeight: 700,
            cursor: confirmed ? 'default' : 'pointer',
          }}
        >
          {confirmed ? '✓ Logged as correct' : 'This is the card'}
        </button>
      </div>
    </div>
  )
}

function Tag({ on, label }: { on: boolean; label: string }) {
  return (
    <span style={{
      padding: '2px 6px', borderRadius: 4,
      background: on ? 'var(--green)' : 'var(--border)',
      color: on ? '#fff' : 'var(--text-muted)',
      fontWeight: 600, fontSize: 10, letterSpacing: 0.3,
    }}>{label}</span>
  )
}

function QualityTag({ q }: { q?: MatchQuality }) {
  if (!q) return null
  const cfg: Record<MatchQuality, { label: string; bg: string; fg: string }> = {
    full:       { label: 'FULL MATCH', bg: 'var(--green)',  fg: '#fff' },
    with_denom: { label: 'NUM + /TOTAL', bg: 'var(--green)', fg: '#fff' },
    numerator:  { label: 'NUM ONLY',   bg: '#f59e0b',       fg: '#fff' },
    name_only:  { label: 'NAME ONLY',  bg: 'var(--border)', fg: 'var(--text-muted)' },
  }
  const c = cfg[q]
  return (
    <span style={{
      padding: '2px 6px', borderRadius: 4,
      background: c.bg, color: c.fg,
      fontWeight: 700, fontSize: 10, letterSpacing: 0.4,
    }}>{c.label}</span>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700,
      color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 0.6,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 4,
    }}>{children}</div>
  )
}

function SignalRow({ label, value, extra }: { label: string; value: string | null; extra?: string | null }) {
  const present = value != null && value !== ''
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
      <span style={{ fontFamily: "'Figtree', sans-serif", fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'Figtree', sans-serif", fontSize: 14,
        color: present ? 'var(--text)' : 'var(--text-muted)',
        fontWeight: present ? 700 : 400, textAlign: 'right',
      }}>
        {present ? value : 'not detected'} {extra && <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 400 }}>{extra}</span>}
      </span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: "'Figtree', sans-serif", fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...panelStyle, textAlign: 'center', fontFamily: "'Figtree', sans-serif", fontSize: 14, color: 'var(--text-muted)' }}>
      {children}
    </div>
  )
}

// ── Style tokens ────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
}

const primaryButtonStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none',
  background: 'var(--primary)', color: '#fff', fontFamily: "'Figtree', sans-serif",
  fontSize: 15, fontWeight: 700, cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: 'var(--bg-light)', color: 'var(--text)',
  border: '1px solid var(--border)',
}

const linkButtonStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--primary)',
  fontFamily: "'Figtree', sans-serif", fontSize: 12, fontWeight: 700,
  cursor: 'pointer', padding: 0, textTransform: 'uppercase', letterSpacing: 0.5,
}

const smallLabelStyle: React.CSSProperties = {
  fontFamily: "'Figtree', sans-serif", fontSize: 11, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700,
}

const selectStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif", fontSize: 13,
}

const statsRowStyle: React.CSSProperties = {
  display: 'flex', gap: 12, marginTop: 8,
}

const mutedNoteStyle: React.CSSProperties = {
  fontFamily: "'Figtree', sans-serif", fontSize: 13, color: 'var(--text-muted)',
  margin: '8px 0 0',
}

const preStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12,
  background: 'var(--bg-light)', padding: 10, borderRadius: 8,
  border: '1px solid var(--border)', color: 'var(--text)',
  maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  margin: '8px 0 0',
}
