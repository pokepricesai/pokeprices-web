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
// Bottom-strip crop sent at higher resolution for crisp number OCR. Vision
// often misses the small printed collector number at full-card scale.
// Strip covers the bottom 35% — modern bottom-LEFT collector numbers and
// the promo badge area sit firmly inside this with margin.
const NUMBER_STRIP_PCT = 0.35
const NUMBER_STRIP_MAX_LONG_EDGE = 1600
const NUMBER_STRIP_QUALITY = 0.92

// Bottom-right corner crop — vintage cards (Base, Jungle, Fossil...) print
// the collector number in the bottom-right at a tiny font. The bottom strip
// is full width so each character only gets a small slice of the OCR
// budget. This dedicated 40% x 22% corner crop scales up to ~1200px on
// the long edge with contrast boost, giving Vision 3-4x more pixels per
// character for that vintage corner number.
const BR_CORNER_X = 0.55          // start at 55% of width
const BR_CORNER_Y = 0.78          // start at 78% of height
const BR_CORNER_W = 0.45          // 45% wide  -> generous, slight overlap with strip is fine
const BR_CORNER_H = 0.22          // 22% tall
const BR_MAX_LONG_EDGE = 1400
const BR_JPEG_QUALITY = 0.94
// Canvas filter applied during the corner crop: light contrast and
// brightness boost so faint vintage print is more legible for OCR. Too
// aggressive and we introduce artefacts that fool Vision, so kept mild.
const BR_CANVAS_FILTER = 'contrast(1.30) brightness(1.05) saturate(0.9)'
// Mirror of the overlay rect (see CardOverlay) so the capture step can crop
// to roughly the same region the user framed against.
const PREVIEW_CONTAINER_ASPECT = 3 / 4   // width / height
const OVERLAY_WIDTH_PCT = 0.78           // of container width
const CARD_ASPECT = 3.5 / 2.5            // height / width
const CROP_PADDING_PCT = 0.06            // pad each edge so we do not clip the printed border
// Multi-frame tilt capture: 5 frames over ~700ms while the user tilts the
// card slightly. We use the cross-frame shimmer pattern to distinguish
// holo (artwork shifts) / reverse holo (frame shifts) / non-holo (static).
const TILT_FRAME_COUNT = 5
const TILT_FRAME_INTERVAL_MS = 150
const TILT_SAMPLE_POINTS = 80            // per region, per frame

type Stage = 'idle' | 'starting' | 'live' | 'captured' | 'scanning' | 'result' | 'error'
type Feature = 'DOCUMENT_TEXT_DETECTION' | 'TEXT_DETECTION'

// ── Holo / reverse-holo detection (tilt-based) ─────────────────────────────
// v1 single-still didn't work: glare and ambient lighting drowned the signal.
// This v2 uses the physical signature the eye relies on — when you tilt a
// holo, bright regions SHIFT and CHANGE COLOUR between frames. Paper glare
// is stationary. We capture N frames over ~700ms while the user tilts the
// card slightly, sample fixed grid points in two regions, then check
// whether the lightness at each point VARIES across frames.
//
// Verdict by ratio (not absolutes) so camera motion can't fake it:
//   artwork shimmer >> frame shimmer → HOLO
//   frame shimmer >> artwork shimmer → REVERSE HOLO
//   both high → likely full art / textured
//   both low  → NON-HOLO

type HoloVerdict = 'holo' | 'reverse_holo' | 'non_holo' | 'full_art' | 'uncertain'

interface RegionStats {
  shimmer_count:    number    // sample points whose lightness varies > threshold across frames
  shimmer_density:  number    // shimmer_count / total sample points
  mean_l_stdev:     number    // average per-point lightness standard deviation across frames
  max_l_stdev:      number    // peak per-point lightness standard deviation
}

interface HoloAnalysis {
  artwork:         RegionStats
  frame:           RegionStats
  shimmer_ratio:   number     // artwork.shimmer_density / frame.shimmer_density
  verdict:         HoloVerdict
  confidence:      number
  frame_count:     number
  capture_ms:      number
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r)      h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else                h = (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}

// Deterministic grid of sample points within a rectangular region. Same
// coordinates used for every frame so per-point variance is comparable.
function gridSamples(x0: number, x1: number, y0: number, y1: number, target: number): { x: number; y: number }[] {
  const w = x1 - x0, h = y1 - y0
  const cols = Math.max(2, Math.round(Math.sqrt(target * w / Math.max(1, h))))
  const rows = Math.max(2, Math.round(target / cols))
  const pts: { x: number; y: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({
        x: Math.floor(x0 + (c + 0.5) * w / cols),
        y: Math.floor(y0 + (r + 0.5) * h / rows),
      })
    }
  }
  return pts
}

function computeShimmerStats(seriesPerPoint: number[][]): RegionStats {
  // For each point, compute the standard deviation of L across frames.
  // A point is "shimmering" if its stdev exceeds SHIMMER_STDEV_THRESHOLD.
  const SHIMMER_STDEV_THRESHOLD = 0.08   // L is 0..1 — sd 0.08 ~= swings of 0.16
  let shimmerCount = 0
  let sumSd = 0
  let maxSd = 0
  for (const ls of seriesPerPoint) {
    if (ls.length < 2) continue
    const mean = ls.reduce((a, b) => a + b, 0) / ls.length
    const variance = ls.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ls.length
    const sd = Math.sqrt(variance)
    sumSd += sd
    if (sd > maxSd) maxSd = sd
    if (sd > SHIMMER_STDEV_THRESHOLD) shimmerCount++
  }
  return {
    shimmer_count:   shimmerCount,
    shimmer_density: shimmerCount / Math.max(1, seriesPerPoint.length),
    mean_l_stdev:    sumSd / Math.max(1, seriesPerPoint.length),
    max_l_stdev:     maxSd,
  }
}

function verdictFromShimmer(artwork: RegionStats, frame: RegionStats): { verdict: HoloVerdict; confidence: number } {
  const a = artwork.shimmer_density
  const f = frame.shimmer_density
  const diff = f - a   // positive = frame dominates

  // Asymmetry test — frame meaningfully more active than artwork → reverse
  // holo. A real reverse holo often has SOME artwork shimmer too (the
  // protective coating reflects), so we test the gap, not just a ratio.
  if (diff > 0.10 && f > 0.20) {
    return { verdict: 'reverse_holo', confidence: Math.min(0.95, 0.55 + diff * 2.0) }
  }
  if (-diff > 0.10 && a > 0.20) {
    return { verdict: 'holo', confidence: Math.min(0.95, 0.55 + (-diff) * 2.0) }
  }
  // Both regions equally hot AND both high → genuine full art / textured.
  if (a > 0.30 && f > 0.30 && Math.abs(diff) <= 0.10) {
    return { verdict: 'full_art', confidence: 0.7 }
  }
  // Both equally static AND both low → non-holo.
  if (a < 0.08 && f < 0.08) {
    return { verdict: 'non_holo', confidence: 0.8 }
  }
  // Anything else — partial signal, can't commit.
  return { verdict: 'uncertain', confidence: 0.4 }
}

type MatchQuality = 'full' | 'with_denom' | 'unknown_denom' | 'numerator' | 'name_only'

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
  promo_match?: boolean
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
    is_promo: boolean
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
  // Default-open so the user can immediately compare what Vision read
  // against what we parsed out of it — most "why did it miss?" debugging
  // starts with checking the raw output anyway.
  const [showRawText, setShowRawText] = useState(true)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [holo, setHolo] = useState<HoloAnalysis | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [numberStripDataUrl, setNumberStripDataUrl] = useState<string | null>(null)
  const [cornerDataUrl, setCornerDataUrl] = useState<string | null>(null)

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

    setCapturing(true)
    const tStart = Date.now()

    const vw = video.videoWidth, vh = video.videoHeight

    // Smart crop: figure out where the on-screen card overlay maps to in
    // native video pixels, then crop to just that region (plus padding).
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

    // Sample grids — same coordinates re-used every frame, so per-point
    // variance across frames is comparable.
    const artworkPts = gridSamples(
      Math.floor(dstW * 0.12), Math.floor(dstW * 0.88),
      Math.floor(dstH * 0.17), Math.floor(dstH * 0.56),
      TILT_SAMPLE_POINTS,
    )
    const framePts = gridSamples(
      Math.floor(dstW * 0.12), Math.floor(dstW * 0.88),
      Math.floor(dstH * 0.76), Math.floor(dstH * 0.93),
      TILT_SAMPLE_POINTS,
    )
    const artworkLs: number[][] = artworkPts.map(() => [])
    const frameLs:   number[][] = framePts.map(() => [])

    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = dstW; tempCanvas.height = dstH
    const tempCtx = tempCanvas.getContext('2d')
    if (!tempCtx) { setError('Canvas not available'); setStage('error'); setCapturing(false); return }

    let mainCanvas: HTMLCanvasElement | null = null
    const midFrameIdx = Math.floor(TILT_FRAME_COUNT / 2)

    for (let f = 0; f < TILT_FRAME_COUNT; f++) {
      if (f > 0) await new Promise(r => setTimeout(r, TILT_FRAME_INTERVAL_MS))
      tempCtx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH)
      const imageData = tempCtx.getImageData(0, 0, dstW, dstH)
      const data = imageData.data
      for (let i = 0; i < artworkPts.length; i++) {
        const p = artworkPts[i]
        const idx = (p.y * dstW + p.x) * 4
        const [, , l] = rgbToHsl(data[idx], data[idx + 1], data[idx + 2])
        artworkLs[i].push(l)
      }
      for (let i = 0; i < framePts.length; i++) {
        const p = framePts[i]
        const idx = (p.y * dstW + p.x) * 4
        const [, , l] = rgbToHsl(data[idx], data[idx + 1], data[idx + 2])
        frameLs[i].push(l)
      }
      // Keep the middle frame as the canonical capture image.
      if (f === midFrameIdx) {
        mainCanvas = document.createElement('canvas')
        mainCanvas.width = dstW; mainCanvas.height = dstH
        mainCanvas.getContext('2d')!.drawImage(tempCanvas, 0, 0)
      }
    }

    if (!mainCanvas) { setError('No frame captured'); setStage('error'); setCapturing(false); return }

    const artworkStats = computeShimmerStats(artworkLs)
    const frameStats   = computeShimmerStats(frameLs)
    const { verdict, confidence } = verdictFromShimmer(artworkStats, frameStats)

    setHolo({
      artwork: artworkStats,
      frame:   frameStats,
      shimmer_ratio: artworkStats.shimmer_density / Math.max(0.01, frameStats.shimmer_density),
      verdict, confidence,
      frame_count: TILT_FRAME_COUNT,
      capture_ms:  Date.now() - tStart,
    })

    // Main JPEG to send to Vision.
    const mainDataUrl = mainCanvas.toDataURL('image/jpeg', JPEG_QUALITY)
    setCapturedDataUrl(mainDataUrl)

    // High-res bottom-strip crop for crisper collector-number OCR.
    const stripSrcY = Math.floor(dstH * (1 - NUMBER_STRIP_PCT))
    const stripSrcH = dstH - stripSrcY
    const stripScale = Math.min(2, NUMBER_STRIP_MAX_LONG_EDGE / Math.max(dstW, stripSrcH))
    const stripDstW = Math.round(dstW * stripScale)
    const stripDstH = Math.round(stripSrcH * stripScale)
    const stripCanvas = document.createElement('canvas')
    stripCanvas.width = stripDstW; stripCanvas.height = stripDstH
    const stripCtx = stripCanvas.getContext('2d')!
    stripCtx.imageSmoothingQuality = 'high'
    stripCtx.drawImage(mainCanvas, 0, stripSrcY, dstW, stripSrcH, 0, 0, stripDstW, stripDstH)
    setNumberStripDataUrl(stripCanvas.toDataURL('image/jpeg', NUMBER_STRIP_QUALITY))

    // Bottom-right corner crop for vintage cards (number printed
    // bottom-right at a tiny font). Contrast-boosted for legibility.
    const brSrcX = Math.floor(dstW * BR_CORNER_X)
    const brSrcY = Math.floor(dstH * BR_CORNER_Y)
    const brSrcW = Math.ceil(dstW * BR_CORNER_W)
    const brSrcH = Math.ceil(dstH * BR_CORNER_H)
    const brScale = Math.min(3, BR_MAX_LONG_EDGE / Math.max(brSrcW, brSrcH))
    const brDstW = Math.round(brSrcW * brScale)
    const brDstH = Math.round(brSrcH * brScale)
    const brCanvas = document.createElement('canvas')
    brCanvas.width = brDstW; brCanvas.height = brDstH
    const brCtx = brCanvas.getContext('2d')!
    brCtx.imageSmoothingQuality = 'high'
    brCtx.filter = BR_CANVAS_FILTER
    brCtx.drawImage(mainCanvas, brSrcX, brSrcY, brSrcW, brSrcH, 0, 0, brDstW, brDstH)
    setCornerDataUrl(brCanvas.toDataURL('image/jpeg', BR_JPEG_QUALITY))

    stopCamera()
    setCapturing(false)
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
        body: JSON.stringify({
          image_base64: base64,
          image_base64_number: numberStripDataUrl
            ? numberStripDataUrl.replace(/^data:image\/\w+;base64,/, '')
            : undefined,
          image_base64_corner: cornerDataUrl
            ? cornerDataUrl.replace(/^data:image\/\w+;base64,/, '')
            : undefined,
          feature,
          holo_analysis: holo,
        }),
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
    setHolo(null)
    setCapturing(false)
    setNumberStripDataUrl(null)
    setCornerDataUrl(null)
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
          ready={stage === 'live' && !capturing}
          capturing={capturing}
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
          holo={holo}
        />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StartPanel({ onStart }: { onStart: () => void }) {
  return (
    <div style={panelStyle}>
      <p style={{ fontFamily: "'Figtree', sans-serif", fontSize: 14, lineHeight: 1.6, margin: '0 0 12px' }}>
        Fill the frame with the card, avoid glare, good lighting helps.
      </p>
      <p style={{ fontFamily: "'Figtree', sans-serif", fontSize: 13, lineHeight: 1.5, margin: '0 0 16px', color: 'var(--text-muted)' }}>
        When you tap capture, <strong style={{ color: 'var(--text)' }}>tilt the card slightly</strong> over the next second
        — that motion is how we tell holos and reverse holos apart (foil shifts; paper does not).
      </p>
      <button onClick={onStart} style={primaryButtonStyle}>Start camera</button>
      <p style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 0' }}>
        Mobile web camera APIs need HTTPS — works on the Vercel deploy but not on localhost.
      </p>
    </div>
  )
}

function LivePanel({
  videoRef, onCapture, ready, capturing,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  onCapture: () => void
  ready: boolean
  capturing: boolean
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
        {capturing && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)', pointerEvents: 'none',
          }}>
            <div style={{
              padding: '14px 22px', borderRadius: 12,
              background: 'rgba(0,0,0,0.7)', color: '#fff',
              fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 700,
              textAlign: 'center', lineHeight: 1.4,
            }}>
              Tilt the card<br />
              <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>capturing 5 frames...</span>
            </div>
          </div>
        )}
      </div>
      <button onClick={onCapture} disabled={!ready} style={{ ...primaryButtonStyle, marginTop: 16, opacity: ready ? 1 : 0.5 }}>
        {capturing ? 'Capturing...' : ready ? 'Capture (then tilt)' : 'Loading...'}
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
  confirmed, confirmError, onConfirm, holo,
}: {
  result: ScanResult
  capturedDataUrl: string
  showRawText: boolean
  onToggleRawText: () => void
  onReset: () => void
  confirmed: string | null
  confirmError: string | null
  onConfirm: (c: Candidate) => void
  holo: HoloAnalysis | null
}) {
  const p = result.parsed
  const noText = !p.full_text || p.full_text.trim().length === 0
  const candidates = reorderByHolo(result.candidates, holo)
  const holoDiag = holoReorderDiagnosis(result.candidates, holo)
  const top = candidates[0]
  const scannedDenom = p.collector_number?.split('/')[1] || null
  const variantNote = (() => {
    if (!top) {
      if (p.collector_number && scannedDenom) {
        return `Scanned ${p.collector_number} cleanly but no card with set total ${scannedDenom} exists in our DB. The set may not be loaded yet — cross-set numerator-only "matches" are suppressed because they would be wrong.`
      }
      return null
    }
    if (top.match_quality === 'full' || top.match_quality === 'with_denom') {
      if ((top.pool_size ?? 1) > 1) {
        return `${top.pool_size} variants of this exact card (regular / reverse holo / etc) — confirm below.`
      }
      return null
    }
    if (top.match_quality === 'unknown_denom') {
      return `Numerator matches but our DB has no set total for ${top.set_name} — verify this is the right set before confirming.`
    }
    if (top.match_quality === 'numerator') {
      return `Scan did not produce a clear denominator. Showing numerator-only matches across sets — pick the right one or rescan.`
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
        <SignalRow label="Promo card" value={p.is_promo ? 'yes — filtering to promo sets' : null} />
      </div>

      {holo && <HoloPanel holo={holo} />}

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
        {holoDiag.reason && (
          <p style={{
            ...mutedNoteStyle,
            color: holoDiag.reordered ? 'var(--primary)' : '#f59e0b',
            fontWeight: 700,
          }}>
            {holoDiag.reason}
          </p>
        )}
        {result.match_error && (
          <p style={{ ...mutedNoteStyle, color: '#ef4444' }}>Match error: {result.match_error}</p>
        )}
        {candidates.length === 0 && !result.match_error && (
          <p style={mutedNoteStyle}>
            {p.collector_number || p.name
              ? 'No matches found for these signals.'
              : 'No signals extracted — nothing to match against.'}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {candidates.map((c, i) => (
            <CandidateCard
              key={c.card_slug + i}
              c={c}
              rank={i + 1}
              displayConfidence={displayConfidenceFor(candidates, i)}
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

// Variant detection. Variants can be encoded several ways in the DB —
// "[Reverse Holo]" in card_name, "-rh" / "-reverse-holo" suffix in
// card_url_slug, or even just the words "Reverse Holo" without brackets.
// We check all of them so a known variant is not missed because of a
// formatting inconsistency in the scraper.
function isReverseHoloVariant(c: Candidate): boolean {
  const name = c.card_name || ''
  const slug = c.card_url_slug || ''
  return (
    /\[\s*reverse\s*holo\s*\]/i.test(name)
    || /\breverse\s*holo\b/i.test(name)
    || /(?:^|[-_])(rh|reverse[-_]?holo|reverse)\b/i.test(slug)
  )
}
function isHoloVariant(c: Candidate): boolean {
  if (isReverseHoloVariant(c)) return false   // mutually exclusive
  const name = c.card_name || ''
  const slug = c.card_url_slug || ''
  return (
    /\[\s*holo\s*\]/i.test(name)
    || /(?:^|\s)holo(?:\s|$)/i.test(name)
    || /(?:^|[-_])holo\b/i.test(slug)
  )
}
function isFullArtVariant(c: Candidate): boolean {
  const name = c.card_name || ''
  const slug = c.card_url_slug || ''
  return (
    /\[\s*(full\s*art|special\s*art|illustration\s*rare|alt\s*art|secret\s*rare|rainbow\s*rare|textured)\s*\]/i.test(name)
    || /(?:^|[-_])(full[-_]?art|alt[-_]?art|illustration[-_]?rare|secret[-_]?rare|textured)\b/i.test(slug)
  )
}

// Re-rank candidates so the variant matching the surface verdict floats to
// the top — but ONLY among candidates that are already tied at the top of
// the confidence ranking. The RPC's confidence score is the source of
// truth; the holo verdict is a tiebreaker, never a promotion above a
// higher-scoring match.
//
// Rationale: previous versions could promote a lower-confidence variant
// above a 100% match because the holo signal said so. That is wrong —
// number + name pin down the card; the holo signal only distinguishes
// reverse-holo vs regular when both are present in the candidates at
// equal confidence.
const HOLO_TIE_WINDOW = 0.04   // within 4% confidence counts as tied
const HOLO_MIN_CONFIDENCE = 0.65

function reorderByHolo(candidates: Candidate[], holo: HoloAnalysis | null): Candidate[] {
  if (!holo || holo.confidence < HOLO_MIN_CONFIDENCE) return candidates
  if (candidates.length < 2) return candidates

  // Tied group at the top: all candidates within HOLO_TIE_WINDOW of #1's confidence.
  const topConf = candidates[0].confidence
  let tieEnd = 1
  while (tieEnd < candidates.length && topConf - candidates[tieEnd].confidence <= HOLO_TIE_WINDOW) {
    tieEnd++
  }
  if (tieEnd < 2) return candidates   // no tie at top — leave the highest-confidence card alone

  const matchesVariant = (c: Candidate): boolean => {
    if (holo.verdict === 'reverse_holo') return isReverseHoloVariant(c)
    if (holo.verdict === 'holo')         return isHoloVariant(c)
    if (holo.verdict === 'full_art')     return isFullArtVariant(c)
    return false
  }

  const tied = candidates.slice(0, tieEnd)
  const tail = candidates.slice(tieEnd)
  const matched = tied.filter(matchesVariant)
  if (matched.length === 0) return candidates   // verdict not represented in the tied group

  const unmatched = tied.filter(c => !matchesVariant(c))
  return [...matched, ...unmatched, ...tail]
}

// Diagnose why the holo verdict did or did not influence ordering.
function holoReorderDiagnosis(
  candidates: Candidate[],
  holo: HoloAnalysis | null,
): { reordered: boolean; reason: string | null } {
  if (!holo) return { reordered: false, reason: null }
  if (holo.verdict !== 'reverse_holo' && holo.verdict !== 'holo' && holo.verdict !== 'full_art') {
    return { reordered: false, reason: null }
  }
  const verdictLabel = holo.verdict.replace('_', ' ')
  const confPct = Math.round(holo.confidence * 100)

  if (holo.confidence < HOLO_MIN_CONFIDENCE) {
    return { reordered: false, reason: `Tilt verdict was ${verdictLabel} but only ${confPct}% confident — not strong enough to reorder.` }
  }
  if (candidates.length < 2) return { reordered: false, reason: null }

  const topConf = candidates[0].confidence
  const tied = candidates.filter(c => topConf - c.confidence <= HOLO_TIE_WINDOW)
  if (tied.length < 2) {
    return { reordered: false, reason: `Top match is alone at ${Math.round(topConf * 100)}% — holo verdict is not used as a tiebreaker when there is nothing to tiebreak.` }
  }

  const matchesVariant = (c: Candidate) =>
    holo.verdict === 'reverse_holo' ? isReverseHoloVariant(c) :
    holo.verdict === 'holo'         ? isHoloVariant(c) :
                                      isFullArtVariant(c)
  const matchedInTied = tied.filter(matchesVariant)
  if (matchedInTied.length === 0) {
    return { reordered: false, reason: `Tilt verdict was ${verdictLabel} (${confPct}% confident) but none of the top ${tied.length} tied candidates are the ${verdictLabel} variant — leaving DB ordering alone.` }
  }

  // Did we actually move anything? (Only if the first tied candidate did not already match.)
  if (matchesVariant(tied[0])) {
    return { reordered: false, reason: null }   // already at top, no reorder needed, no message
  }
  return { reordered: true, reason: `Tiebreak: ${verdictLabel} variant promoted to top among ${tied.length} candidates within ${Math.round(HOLO_TIE_WINDOW * 100)}% of each other.` }
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
          <Tag on={!!c.promo_match} label="promo" />
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

function HoloPanel({ holo }: { holo: HoloAnalysis }) {
  const verdictMap: Record<HoloVerdict, { label: string; color: string }> = {
    holo:          { label: 'HOLO',          color: 'var(--green)' },
    reverse_holo:  { label: 'REVERSE HOLO',  color: 'var(--primary)' },
    full_art:      { label: 'FULL ART / TEXTURED', color: 'var(--green)' },
    non_holo:      { label: 'NON-HOLO',      color: 'var(--text-muted)' },
    uncertain:     { label: 'UNCERTAIN',     color: '#f59e0b' },
  }
  const v = verdictMap[holo.verdict]
  return (
    <div style={panelStyle}>
      <SectionTitle>Surface analysis (tilt)</SectionTitle>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 700,
          color: v.color,
        }}>{v.label}</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          {Math.round(holo.confidence * 100)}% confidence
        </span>
      </div>
      <p style={{ ...mutedNoteStyle, fontSize: 12 }}>
        Detects bright regions that SHIFT between {holo.frame_count} captured frames as you tilt.
        Foil moves with angle; paper does not. If you did not tilt, both regions will read low.
      </p>
      <div style={statsRowStyle}>
        <Stat label="Artwork shimmer" value={`${(holo.artwork.shimmer_density * 100).toFixed(0)}%`} />
        <Stat label="Frame shimmer"   value={`${(holo.frame.shimmer_density * 100).toFixed(0)}%`} />
        <Stat label="Ratio (A/F)"     value={holo.shimmer_ratio.toFixed(2)} />
        <Stat label="Captured in"     value={`${holo.capture_ms} ms`} />
      </div>
      <div style={{ marginTop: 10, fontFamily: "'Figtree', sans-serif", fontSize: 11, color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--text)' }}>Artwork region</strong>
        {' — '}{holo.artwork.shimmer_count} shimmering sample points,
        {' '}mean L stdev {holo.artwork.mean_l_stdev.toFixed(3)},
        {' '}max L stdev {holo.artwork.max_l_stdev.toFixed(3)}
      </div>
      <div style={{ marginTop: 4, fontFamily: "'Figtree', sans-serif", fontSize: 11, color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--text)' }}>Frame region</strong>
        {' — '}{holo.frame.shimmer_count} shimmering sample points,
        {' '}mean L stdev {holo.frame.mean_l_stdev.toFixed(3)},
        {' '}max L stdev {holo.frame.max_l_stdev.toFixed(3)}
      </div>
    </div>
  )
}

function QualityTag({ q }: { q?: MatchQuality }) {
  if (!q) return null
  const cfg: Record<MatchQuality, { label: string; bg: string; fg: string }> = {
    full:          { label: 'FULL MATCH',    bg: 'var(--green)',  fg: '#fff' },
    with_denom:    { label: 'NUM + /TOTAL',  bg: 'var(--green)',  fg: '#fff' },
    unknown_denom: { label: 'TOTAL UNKNOWN', bg: '#f59e0b',       fg: '#fff' },
    numerator:     { label: 'NUM ONLY',      bg: '#f59e0b',       fg: '#fff' },
    name_only:     { label: 'NAME ONLY',     bg: 'var(--border)', fg: 'var(--text-muted)' },
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
