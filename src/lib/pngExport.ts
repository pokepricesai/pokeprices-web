// pngExport — reusable client-side capture pipeline.
// Used by Studio and the per-Pokémon "Download insight" feature.
// Handles: image inlining (CORS-safe via /api/imgproxy), decode wait,
// transparent fallback for failed images, Web Share API for mobile
// camera-roll save, falls back to download elsewhere.

const HTML_TO_IMAGE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js'

const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='

let htmlToImagePromise: Promise<any> | null = null

async function ensureHtmlToImage(): Promise<any> {
  const w = window as any
  if (w.htmlToImage) return w.htmlToImage
  if (htmlToImagePromise) return htmlToImagePromise
  htmlToImagePromise = new Promise<any>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = HTML_TO_IMAGE_URL
    s.onload = () => {
      const lib = (window as any).htmlToImage
      if (lib) resolve(lib)
      else reject(new Error('html-to-image failed to attach'))
    }
    s.onerror = () => reject(new Error('Failed to load export library'))
    document.head.appendChild(s)
  })
  return htmlToImagePromise
}

function fetchUrlForImage(src: string): string {
  const ts = Date.now()
  const isSameOrigin = src.startsWith(window.location.origin) || src.startsWith('/')
  if (isSameOrigin) return src
  if (src.includes('/api/imgproxy')) return src.split('&b=')[0] + '&b=export_' + ts
  return '/api/imgproxy?url=' + encodeURIComponent(src) + '&b=export_' + ts
}

async function inlineImages(el: HTMLElement): Promise<{ imgs: HTMLImageElement[]; origSrcs: string[] }> {
  const imgs = Array.from(el.querySelectorAll('img')) as HTMLImageElement[]
  const origSrcs: string[] = []

  await Promise.all(imgs.map(async (img, i) => {
    origSrcs[i] = img.src
    const fetchUrl = fetchUrlForImage(img.src)
    try {
      const res = await fetch(fetchUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error(`fetch ${res.status}`)
      const blob = await res.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      img.src = dataUrl
    } catch (err) {
      console.warn('[pngExport] failed to inline image, using placeholder:', img.src, err)
      img.src = TRANSPARENT_PIXEL
    }
  }))

  // Wait for each <img> to actually decode into a bitmap.
  await Promise.all(imgs.map(img =>
    img.decode().catch(() => { /* swallow — placeholder will render blank */ })
  ))

  return { imgs, origSrcs }
}

export async function captureElementToDataUrl(
  elementId: string,
  options: { pixelRatio?: number } = {},
): Promise<string> {
  const el = document.getElementById(elementId)
  if (!el) throw new Error(`Element #${elementId} not found`)

  const htmlToImage = await ensureHtmlToImage()
  const { imgs, origSrcs } = await inlineImages(el)

  try {
    return await htmlToImage.toPng(el, {
      pixelRatio: options.pixelRatio ?? 2,
      cacheBust: true,
      imagePlaceholder: TRANSPARENT_PIXEL,
    })
  } finally {
    imgs.forEach((img, i) => { if (origSrcs[i]) img.src = origSrcs[i] })
  }
}

// Detect mobile / touch devices. We only want to show the Web Share UI on
// phones and tablets — desktop Chrome supports navigator.share but invokes a
// system share sheet that's confusing for users who just want a download.
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/Mobi|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|IEMobile/i.test(ua)) return true
  // iPadOS 13+ identifies as Mac; check for touch + small-ish viewport as a heuristic
  if ((navigator as any).maxTouchPoints > 1 && /Macintosh/.test(ua) && typeof window !== 'undefined' && window.innerWidth < 1200) {
    return true
  }
  return false
}

export async function shareOrDownloadPng(
  dataUrl: string,
  fileName: string,
  shareTitle = 'PokePrices',
  shareText = 'Made with PokePrices',
): Promise<{ shared: boolean }> {
  let shared = false

  // Only attempt Web Share on mobile. On desktop, always download.
  if (isMobileDevice()) {
    try {
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], fileName, { type: 'image/png' })
      const nav: any = navigator
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: shareTitle, text: shareText })
        shared = true
      }
    } catch (err: any) {
      // AbortError = user dismissed the native share sheet — treat as success
      if (err?.name === 'AbortError') {
        shared = true
      } else {
        console.warn('[pngExport] share failed, falling back to download:', err)
      }
    }
  }

  if (!shared) {
    const link = document.createElement('a')
    link.download = fileName
    link.href = dataUrl
    link.click()
  }
  return { shared }
}

export async function exportElementAsPng(opts: {
  elementId: string
  fileName: string
  pixelRatio?: number
  shareTitle?: string
  shareText?: string
}): Promise<{ shared: boolean }> {
  const dataUrl = await captureElementToDataUrl(opts.elementId, { pixelRatio: opts.pixelRatio })
  return shareOrDownloadPng(dataUrl, opts.fileName, opts.shareTitle, opts.shareText)
}

// True when both: (a) we're on a mobile device, AND (b) the browser actually
// supports sharing files via the Web Share API. UI uses this to switch the
// button label between "Save / Share" (mobile) and "Download" (desktop).
export function canShareFiles(): boolean {
  if (!isMobileDevice()) return false
  try {
    const nav: any = navigator
    if (!nav.canShare) return false
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', { type: 'image/png' })
    return !!nav.canShare({ files: [probe] })
  } catch {
    return false
  }
}
