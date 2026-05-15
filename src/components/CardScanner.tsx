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

export interface ConfirmContext {
  isBulk: boolean        // true when the scanner has more than 1 image in queue
  queueLength: number    // total images chosen
  queueIndex: number     // 0-based index of the current image
}

export default function CardScanner({
  onCardConfirmed,
  onClose,
  ctaLabel = 'Use this card',
}: {
  onCardConfirmed: (card: ConfirmedCard, ctx: ConfirmContext) => void | Promise<void>
  onClose?: () => void
  ctaLabel?: string
}) {
  const [stage, setStage] = useState<'idle' | 'collecting' | 'scanning' | 'results' | 'limit' | 'error'>('idle')
  // Pending stack for the mobile "take many photos" flow — each camera
  // shot accumulates here, user taps "Done" to flush the stack into the
  // normal processing queue.
  const [pending, setPending] = useState<File[]>([])
  const [mode, setMode] = useState<'single' | 'multi-camera'>('single')
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<File[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null)
  const [response, setResponse] = useState<ScanResponse | null>(null)
  // Default to OCR. AI Vision is the fallback the user can tap when OCR
  // gets the read wrong — it tends to be more deterministic on digits
  // (the most common failure mode) and ~half the cost.
  const [engine, setEngine] = useState<Engine>('vision_ocr')
  const [retriedWithAlternate, setRetriedWithAlternate] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [scansRemaining, setScansRemaining] = useState<number | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  // Two refs because mobile needs TWO inputs: one with capture="environment"
  // (opens the camera straight to a single shot) and one without (lets iOS
  // multi-select from the gallery, so users can pre-shoot N cards with the
  // native Camera app and then bulk-pick them here).
  const cameraInputRef  = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  // Width-based mobile detection. Tablets in landscape will see the
  // desktop copy, which is fine — the underlying file input behaviour
  // doesn't change, only the copy around it.
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

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

  function openCameraSingle() {
    setMode('single')
    cameraInputRef.current?.click()
  }
  function openCameraMulti() {
    setMode('multi-camera')
    cameraInputRef.current?.click()
  }
  function openGallery() {
    setMode('single')
    galleryInputRef.current?.click()
  }

  async function handleFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return
    const arr = Array.from(files)
    // Multi-camera mode: accumulate into pending, show "take another"
    // panel instead of starting the scan run.
    if (mode === 'multi-camera') {
      setPending(prev => [...prev, ...arr])
      setStage('collecting')
      // Reset input value so the same file can be re-selected if needed.
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      return
    }
    setQueue(arr)
    setQueueIndex(0)
    setRetriedWithAlternate(false)
    setEngine('vision_ocr')
    await processFile(arr[0], 'vision_ocr')
  }

  async function startProcessingPending() {
    if (pending.length === 0) return
    setQueue(pending)
    setQueueIndex(0)
    setPending([])
    setMode('single')
    setRetriedWithAlternate(false)
    setEngine('vision_ocr')
    await processFile(pending[0], 'vision_ocr')
  }

  function cancelPending() {
    setPending([])
    setMode('single')
    setStage('idle')
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

  async function retryWithAlternate() {
    if (queue.length === 0) return
    setRetriedWithAlternate(true)
    // OCR is the default, so the alternate is always AI Vision.
    setEngine('ai_vision')
    await processFile(queue[queueIndex], 'ai_vision')
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
    // Await the host so it can do an async save (e.g. silent quick-add to
    // portfolio) before the scanner advances. The ctx tells the host
    // whether this is part of a bulk run or a one-off.
    await onCardConfirmed({
      card_slug: c.card_slug,
      card_name: c.card_name,
      clean_name: c.clean_name,
      set_name: c.set_name,
      card_url_slug: c.card_url_slug,
      image_url: c.image_url,
      card_number_display: c.card_number_display,
      variant: response?.ai_variant ?? null,
    }, {
      isBulk:     queue.length > 1,
      queueLength: queue.length,
      queueIndex,
    })
    // Move to next in queue or reset.
    if (queueIndex + 1 < queue.length) {
      const nextIdx = queueIndex + 1
      setQueueIndex(nextIdx)
      setRetriedWithAlternate(false)
      setEngine('vision_ocr')
      await processFile(queue[nextIdx], 'vision_ocr')
    } else {
      reset()
    }
  }

  function skipCurrent() {
    if (queueIndex + 1 < queue.length) {
      const nextIdx = queueIndex + 1
      setQueueIndex(nextIdx)
      setRetriedWithAlternate(false)
      setEngine('vision_ocr')
      processFile(queue[nextIdx], 'vision_ocr')
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
    setRetriedWithAlternate(false)
    setEngine('vision_ocr')
    setPending([])
    setMode('single')
    if (cameraInputRef.current)  cameraInputRef.current.value  = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  const candidates = response?.candidates ?? []
  const queueRemaining = queue.length > 0 ? queue.length - queueIndex - 1 : 0

  return (
    <div style={panelStyle}>
      <Header onClose={onClose} scansRemaining={scansRemaining} />

      {/* Camera input — capture="environment" opens the rear camera
          straight to a single photo on mobile. On desktop the attribute
          is ignored and it falls through to the file picker. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        // @ts-expect-error capture is valid HTML, not in React typings yet
        capture="environment"
        style={{ display: 'none' }}
        onChange={e => handleFilesChosen(e.target.files)}
      />
      {/* Gallery input — no capture attribute, multiple files. On iOS this
          opens the photo library with multi-select, so a user can take
          20 photos with the native Camera app first then upload them
          all here in one go. On desktop this is the file picker. */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={e => handleFilesChosen(e.target.files)}
      />

      {stage === 'idle' && (
        <IdlePanel
          onCameraSingle={openCameraSingle}
          onCameraMulti={openCameraMulti}
          onGallery={openGallery}
          isMobile={isMobile}
        />
      )}

      {stage === 'collecting' && (
        <CollectingPanel
          pending={pending}
          onTakeAnother={() => cameraInputRef.current?.click()}
          onDone={startProcessingPending}
          onCancel={cancelPending}
        />
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
          retriedWithAlternate={retriedWithAlternate}
          onConfirm={confirmCandidate}
          onRetryAlternate={retryWithAlternate}
          onSkip={skipCurrent}
          onCancel={reset}
        />
      )}

      {stage === 'limit' && response && (
        <LimitPanel message={response.message ?? 'Free tier limit reached this month.'} onClose={reset} />
      )}

      {stage === 'error' && error && (
        <ErrorPanel message={error} onRetry={isMobile ? openCameraSingle : openGallery} onClose={reset} />
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

function IdlePanel({
  onCameraSingle, onCameraMulti, onGallery, isMobile,
}: {
  onCameraSingle: () => void
  onCameraMulti:  () => void
  onGallery:      () => void
  isMobile:       boolean
}) {
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.55 }}>
          One card, a whole stack with the camera, or photos you took earlier — all work.
        </p>
        <button onClick={onCameraSingle} style={primaryButtonStyle}>
          Take a photo
        </button>
        <button onClick={onCameraMulti} style={secondaryButtonStyle}>
          Take many photos in a row
        </button>
        <button onClick={onGallery} style={secondaryButtonStyle}>
          Choose from gallery — bulk OK
        </button>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '4px 0 0', lineHeight: 1.5 }}>
          Bulk modes step through your photos one by one, confirm each match before moving on. Avoid glare, fill the frame, good lighting helps.
        </p>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.55 }}>
        On desktop there is no camera scan — tap below to upload one or more card photos from your computer. They are processed one by one and you confirm each match as it appears.
      </p>
      <button onClick={onGallery} style={primaryButtonStyle}>
        Upload card image(s)
      </button>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '4px 0 0', lineHeight: 1.5 }}>
        Avoid glare, fill the frame, good lighting helps. If the read looks wrong on the result screen, the &quot;Try AI mode&quot; button reruns the same image through Claude vision.
      </p>
    </div>
  )
}

function CollectingPanel({
  pending, onTakeAnother, onDone, onCancel,
}: {
  pending: File[]
  onTakeAnother: () => void
  onDone: () => void
  onCancel: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", margin: 0, fontWeight: 700 }}>
        {pending.length} photo{pending.length === 1 ? '' : 's'} so far
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.55 }}>
        Take more photos one after another, then tap &quot;Process them all&quot; when you are done. The scanner will work through them one by one.
      </p>
      {/* Tiny thumbnail strip so users can see roughly what was captured. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {pending.slice(-12).map((f, i) => (
          <ThumbnailTile key={i} file={f} />
        ))}
        {pending.length > 12 && (
          <div style={{
            width: 48, height: 64, borderRadius: 6,
            background: 'var(--bg-light)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700,
          }}>
            +{pending.length - 12}
          </div>
        )}
      </div>
      <button onClick={onTakeAnother} style={primaryButtonStyle}>
        Take another
      </button>
      <button onClick={onDone} style={secondaryButtonStyle} disabled={pending.length === 0}>
        Process {pending.length} {pending.length === 1 ? 'photo' : 'photos'}
      </button>
      <button onClick={onCancel} style={linkButtonStyle}>
        Cancel — discard photos
      </button>
    </div>
  )
}

function ThumbnailTile({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  if (!url) return null
  return (
    <img src={url} alt="captured" style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
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
  ctaLabel, retriedWithAlternate, onConfirm, onRetryAlternate, onSkip, onCancel,
}: {
  response: ScanResponse
  candidates: Candidate[]
  imageUrl: string
  queueLabel: string | null
  queueRemaining: number
  ctaLabel: string
  retriedWithAlternate: boolean
  onConfirm: (c: Candidate) => void
  onRetryAlternate: () => void
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
          {!retriedWithAlternate && (
            <button onClick={onRetryAlternate} style={secondaryButtonStyle}>Try AI mode instead</button>
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
        {!retriedWithAlternate && !noResults && top && (
          <button onClick={onRetryAlternate} style={linkButtonStyle}>None of these? Try AI mode</button>
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
