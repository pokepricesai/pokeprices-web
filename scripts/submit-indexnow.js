// scripts/submit-indexnow.js
// Manual IndexNow submitter for PokePrices.
//
// Usage:
//   node scripts/submit-indexnow.js                          # uses hardcoded test list
//   node scripts/submit-indexnow.js <url> <url> ...          # submits these URLs
//   npm run indexnow -- https://www.pokeprices.io/browse     # via npm script
//
// IndexNow accepts up to 10,000 URLs per request; we cap at 1,000 here so
// failed batches stay small while we are still validating the integration.

const INDEXNOW_KEY = 'a8f92c1d7e4b49d2b7c5e913f4aa8179'
const HOST         = 'www.pokeprices.io'
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`
const ENDPOINT     = 'https://api.indexnow.org/indexnow'
const BATCH_SIZE   = 1000

const TEST_URLS = [
  `https://${HOST}/`,
  `https://${HOST}/browse`,
  `https://${HOST}/ai-assistant`,
  `https://${HOST}/tools`,
  `https://${HOST}/insights`,
  `https://${HOST}/pokemon`,
  `https://${HOST}/set/Chaos%20Rising`,
  `https://${HOST}/set/Ascended%20Heroes`,
]

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function submitBatch(urls, batchIndex, totalBatches) {
  const payload = {
    host:        HOST,
    key:         INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList:     urls,
  }

  const label = totalBatches > 1 ? `[batch ${batchIndex + 1}/${totalBatches}]` : ''
  console.log(`${label} POST ${ENDPOINT} — ${urls.length} URL(s)`)

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    console.log(`${label} status: ${response.status}`)
    if (text.trim().length > 0) console.log(`${label} body: ${text}`)
    return { ok: response.ok, status: response.status, text }
  } catch (err) {
    console.error(`${label} request failed: ${err.message}`)
    return { ok: false, status: 0, text: err.message }
  }
}

async function main() {
  const argUrls = process.argv.slice(2).filter(Boolean)
  const urls    = argUrls.length > 0 ? argUrls : TEST_URLS
  const source  = argUrls.length > 0 ? 'command-line arguments' : 'built-in test list'

  console.log(`IndexNow submitter — ${urls.length} URL(s) from ${source}`)
  console.log(`Host: ${HOST}`)
  console.log(`Key file: ${KEY_LOCATION}`)
  console.log('')

  const batches = chunk(urls, BATCH_SIZE)
  const failures = []

  for (let i = 0; i < batches.length; i++) {
    const result = await submitBatch(batches[i], i, batches.length)
    if (!result.ok) failures.push({ batch: i + 1, status: result.status, text: result.text })
  }

  console.log('')
  console.log(`Done. Submitted ${urls.length} URL(s) in ${batches.length} batch(es).`)
  if (failures.length > 0) {
    console.error(`Failed batches: ${failures.length}`)
    for (const f of failures) console.error(`  batch ${f.batch}: status ${f.status} — ${f.text}`)
    process.exit(1)
  }
}

main()
