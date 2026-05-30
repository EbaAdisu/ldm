const LDM_URL = 'http://localhost:6543'

// ── Per-tab state ─────────────────────────────────────────────────────────────
const tabMediaUrls = new Map()  // tabId → Set of intercepted URLs

// ── Default extension settings (synced from LDM backend) ─────────────────────
let extSettings = {
  minInterceptSize: 1048576,   // 1 MB
  interceptTypes: new Set([
    'mp4','mkv','webm','avi','mov','flv','wmv','ts',
    'mp3','wav','ogg','aac','flac','m4a',
    'zip','rar','7z','iso','pdf','exe','deb','rpm',
  ]),
}

// Sync settings from LDM backend on startup and periodically
async function syncSettings() {
  try {
    const res  = await fetch(`${LDM_URL}/api/settings`)
    const data = await res.json()
    extSettings.minInterceptSize = parseInt(data.minInterceptSize || 1048576)
    extSettings.interceptTypes   = new Set((data.interceptTypes || '').split(',').map(s => s.trim()))
  } catch { /* LDM not running */ }
}
syncSettings()
setInterval(syncSettings, 30_000)

// ── Layer 1: Content-Type header sniffing (catches files on ANY site) ─────────
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    // Ignore requests from localhost (our own UI)
    if (details.initiator?.includes('localhost')) return
    // Only look at top-level navigations and XHR/fetch — not sub-resources like images
    const watchTypes = ['main_frame', 'sub_frame', 'xmlhttprequest', 'other', 'media']
    if (!watchTypes.includes(details.type)) return

    const headers       = details.responseHeaders || []
    const contentType   = headers.find(h => h.name.toLowerCase() === 'content-type')?.value || ''
    const contentLength = parseInt(headers.find(h => h.name.toLowerCase() === 'content-length')?.value || '0')

    if (!isInterceptableContentType(contentType)) return

    // Respect minimum file size setting
    if (contentLength > 0 && contentLength < extSettings.minInterceptSize) return

    // Don't double-intercept the same URL
    if (!tabMediaUrls.has(details.tabId)) tabMediaUrls.set(details.tabId, new Set())
    if (tabMediaUrls.get(details.tabId).has(details.url)) return
    tabMediaUrls.get(details.tabId).add(details.url)

    console.log('[LDM] interceptable Content-Type detected:', contentType, details.url, 'frame:', details.frameId)

    // Send to the frame that got the response, fallback to main frame
    chrome.tabs.sendMessage(details.tabId, {
      type: 'intercept_detected',
      url: details.url,
      contentType,
      size: contentLength,
    }, { frameId: details.frameId }).catch(() => {
      chrome.tabs.sendMessage(details.tabId, {
        type: 'intercept_detected',
        url: details.url,
        contentType,
        size: contentLength,
      }).catch(() => {})
    })
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
)

// ── Layer 2: URL pattern sniffing on requests (catches media streams) ─────────
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.initiator?.includes('localhost')) return

    const ext = getUrlExt(details.url)
    if (!ext || !extSettings.interceptTypes.has(ext)) return

    const tab = details.tabId
    if (tab < 0) return
    if (!tabMediaUrls.has(tab)) tabMediaUrls.set(tab, new Set())
    if (tabMediaUrls.get(tab).has(details.url)) return
    tabMediaUrls.get(tab).add(details.url)

    console.log('[LDM] media URL detected via request:', details.url, 'frame:', details.frameId)

    // Send to the exact frame that made the request (works for iframe video players)
    chrome.tabs.sendMessage(tab, {
      type: 'media_detected',
      url: details.url,
    }, { frameId: details.frameId }).catch(() => {
      // If the specific frame has no content script, try main frame as fallback
      chrome.tabs.sendMessage(tab, { type: 'media_detected', url: details.url }).catch(() => {})
    })
  },
  { urls: ['<all_urls>'] }
)

// ── Tab cleanup ───────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => tabMediaUrls.delete(tabId))

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get_cookies') {
    try {
      const u = new URL(msg.url)
      chrome.cookies.getAll({ url: `${u.protocol}//${u.hostname}` })
        .then(jar => sendResponse({ cookies: jar.map(c => `${c.name}=${c.value}`).join('; ') }))
        .catch(() => sendResponse({ cookies: '' }))
    } catch { sendResponse({ cookies: '' }) }
    return true
  }

  if (msg.type === 'get_quality_sizes') {
    const referer = msg.referer || ''
    Promise.all(
      (msg.sources || []).map(async (source) => {
        try {
          const ctrl = new AbortController()
          const t    = setTimeout(() => ctrl.abort(), 4000)
          const res  = await fetch(source.url, {
            method:  'HEAD',
            headers: { 'Referer': referer, 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
            signal:  ctrl.signal,
          })
          clearTimeout(t)
          const bytes = parseInt(res.headers.get('content-length') || '0')
          return { ...source, size: bytes, sizeStr: bytes > 0 ? bgFormatBytes(bytes) : '—' }
        } catch {
          return { ...source, size: 0, sizeStr: '—' }
        }
      })
    ).then(results => sendResponse({ sources: results }))
    return true
  }

  if (msg.type === 'download') {
    sendToLDM(msg.url, msg.engine, msg.referer, msg.cookies, msg.quality, msg.pageUrl)
      .then(data => sendResponse({ ok: true, id: data?.id }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (msg.type === 'get_tab_media') {
    const urls = [...(tabMediaUrls.get(sender.tab?.id) || [])]
    sendResponse({ urls })
    return false
  }

  if (msg.type === 'get_downloads') {
    fetch(`${LDM_URL}/api/downloads`)
      .then(r => r.json())
      .then(data => sendResponse({ downloads: data }))
      .catch(() => sendResponse({ downloads: [] }))
    return true
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function bgFormatBytes(bytes) {
  if (!bytes) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0, n = bytes
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${u[i]}`
}

async function sendToLDM(url, engine, referer, cookies, quality, pageUrl) {
  const res  = await fetch(`${LDM_URL}/api/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      ...(engine  && { engine }),
      ...(referer && { referer }),
      ...(cookies && { cookies }),
      ...(quality  && { quality }),
      ...(pageUrl  && { pageUrl }),
    }),
  })
  if (!res.ok) throw new Error(`LDM returned ${res.status}`)
  const data = await res.json()

  chrome.notifications.create(`ldm-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'LDM — Download Added',
    message: url.length > 60 ? url.slice(0, 57) + '...' : url,
  })

  return data
}

function isInterceptableContentType(ct) {
  if (!ct) return false
  ct = ct.toLowerCase().split(';')[0].trim()
  return (
    ct.startsWith('video/') ||
    ct.startsWith('audio/') ||
    ct === 'application/octet-stream' ||
    ct === 'application/zip' ||
    ct === 'application/x-zip-compressed' ||
    ct === 'application/x-rar-compressed' ||
    ct === 'application/pdf' ||
    ct === 'application/x-iso9660-image' ||
    ct === 'application/x-bittorrent' ||
    // HLS and DASH streaming manifests
    ct === 'application/x-mpegurl' ||
    ct === 'application/vnd.apple.mpegurl' ||
    ct === 'application/dash+xml'
  )
}

function getUrlExt(url) {
  try {
    const path = new URL(url).pathname
    const ext  = path.split('.').pop().toLowerCase()
    return ext.length <= 5 ? ext : null
  } catch { return null }
}
