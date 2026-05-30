;(function () {
  'use strict'

  const injectedVideos = new WeakSet()
  const injectedLinks  = new WeakSet()
  const seenUrls       = new Set()

  // Fix 1: store the latest intercepted stream URL per video element.
  // This is updated any time background detects a real media URL, even if the
  // button was already injected. Click reads from this map at the moment of click
  // so it always uses the most up-to-date URL instead of the PHP embed page URL.
  const videoStreamUrls = new WeakMap()

  const FILE_EXTS = new Set([
    'mp4','webm','mkv','avi','mov','flv','m4v','wmv','ts',
    'mp3','ogg','wav','aac','flac','opus','m4a',
    'zip','rar','7z','tar','gz','bz2','xz','iso','dmg',
    'exe','deb','rpm','apk','msi',
    'pdf','epub','mobi',
    'm3u8','mpd',
  ])

  // ── Layer 3: <video> element injection ───────────────────────────────────────

  function getVideoSrc(video) {
    const src = video.src || video.currentSrc ||
      video.querySelector('source')?.src ||
      video.getAttribute('data-src') ||
      video.getAttribute('data-url') || null
    // blob: URLs are not downloadable directly — ignore them
    return src && !src.startsWith('blob:') ? src : null
  }

  function injectVideoButton(video, streamUrl = null) {
    // Always update the stored stream URL if a better one arrives later
    if (streamUrl) {
      videoStreamUrls.set(video, streamUrl)
      console.log('[LDM] stream URL updated for video:', streamUrl)
    }

    if (injectedVideos.has(video)) return   // button already in DOM, URL updated above
    if (video.offsetWidth < 100) return
    injectedVideos.add(video)

    const btn = document.createElement('button')
    btn.className = 'ldm-btn'
    btn.innerHTML = '<span>⬇</span> LDM'
    btn.title = 'Download with LDM'
    document.body.appendChild(btn)

    function reposition() {
      const r = video.getBoundingClientRect()
      if (r.width < 10 || r.height < 10 || r.bottom < 0 || r.top > window.innerHeight) {
        btn.style.opacity = '0'
        btn.style.pointerEvents = 'none'
        return
      }
      btn.style.opacity = '1'
      btn.style.pointerEvents = ''
      btn.style.top   = `${r.top + 8}px`
      btn.style.right = `${window.innerWidth - r.right + 8}px`
    }

    reposition()
    window.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition, { passive: true })
    new ResizeObserver(reposition).observe(video)

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      // At click time, prefer: intercepted stream URL > element src > page URL
      const src = videoStreamUrls.get(video) || getVideoSrc(video) || window.location.href
      console.log('[LDM] download clicked, url:', src)
      sendDownload(src, btn)
    })

    console.log('[LDM] button injected on video in', location.href)
  }

  function scanVideos() {
    const videos = document.querySelectorAll('video')
    console.log('[LDM] scan:', videos.length, 'video(s) on', location.href)
    videos.forEach(v => injectVideoButton(v))
  }

  // ── Layer 2: <a href> download link injection ─────────────────────────────────

  function getLinkExt(href) {
    try {
      const path = new URL(href, location.href).pathname
      const ext  = path.split('.').pop().toLowerCase().split('?')[0]
      return FILE_EXTS.has(ext) ? ext : null
    } catch { return null }
  }

  function injectLinkButton(anchor) {
    if (injectedLinks.has(anchor)) return
    const ext = getLinkExt(anchor.href)
    if (!ext) return
    injectedLinks.add(anchor)

    const btn = document.createElement('button')
    btn.className = 'ldm-link-btn'
    btn.innerHTML = '⬇'
    btn.title = `Download .${ext} with LDM`
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      sendDownload(anchor.href, btn, true)
    })
    anchor.insertAdjacentElement('afterend', btn)
  }

  function scanLinks() {
    document.querySelectorAll('a[href]').forEach(injectLinkButton)
  }

  // ── Layer 1: intercept bar (Content-Type sniff from background) ───────────────

  function showInterceptBar(url, contentType, size) {
    if (seenUrls.has(url)) return
    seenUrls.add(url)

    document.getElementById('ldm-intercept-bar')?.remove()

    const sizeStr = size > 0 ? ` · ${formatSize(size)}` : ''
    const typeStr = contentType.split('/')[1]?.split(';')[0] || url.split('.').pop().split('?')[0].toUpperCase().slice(0, 5)

    const bar = document.createElement('div')
    bar.id = 'ldm-intercept-bar'
    bar.innerHTML = `
      <span class="ldm-bar-icon">⬇</span>
      <span class="ldm-bar-text">LDM detected a <strong>${typeStr.toUpperCase()}</strong> file${sizeStr}</span>
      <button class="ldm-bar-dl">Download with LDM</button>
      <button class="ldm-bar-close" title="Dismiss">✕</button>
    `
    bar.querySelector('.ldm-bar-dl').onclick = () => { sendDownload(url, bar.querySelector('.ldm-bar-dl')); setTimeout(() => bar.remove(), 1500) }
    bar.querySelector('.ldm-bar-close').onclick = () => bar.remove()
    document.body.appendChild(bar)
    setTimeout(() => bar?.remove(), 12_000)
  }

  // ── Send download — direct fetch with background worker fallback ──────────────
  // Fix 2: HTTPS pages (wcostream.com) can block HTTP→localhost fetch due to
  // mixed-content rules. If direct fetch fails, fall back to routing through
  // the background service worker which is not subject to page-level CSP.

  function sendDownload(url, el, isLink = false) {
    const original = el.innerHTML
    el.innerHTML = isLink ? '...' : '⏳ Adding...'
    console.log('[LDM] sending download:', url)

    function onSuccess(id) {
      console.log('[LDM] added, id:', id)
      el.innerHTML = isLink ? '✓' : '✓ Added'
      el.classList.add(isLink ? 'ldm-link-btn--done' : 'ldm-btn--done')
      setTimeout(() => { el.innerHTML = original; el.classList.remove('ldm-link-btn--done', 'ldm-btn--done') }, 3000)
    }

    function onError(reason) {
      console.error('[LDM] failed:', reason)
      el.innerHTML = isLink ? '!' : '✗ Failed'
      setTimeout(() => { el.innerHTML = original }, 2500)
    }

    function viaBackground() {
      if (!chrome.runtime?.id) { onError('extension context gone'); return }
      chrome.runtime.sendMessage({ type: 'download', url }, res => {
        if (chrome.runtime.lastError) {
          onError('background unavailable: ' + chrome.runtime.lastError.message)
        } else if (res?.ok) {
          onSuccess(res.id)
        } else {
          onError(res?.error || 'background error')
        }
      })
    }

    // HTTPS pages (most sites) block HTTP→localhost fetch (mixed content).
    // Skip straight to background worker — it runs outside page CSP so it can
    // always reach localhost. Only use direct fetch on HTTP pages.
    if (location.protocol === 'https:') {
      viaBackground()
      return
    }

    fetch('http://localhost:6543/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.id) onSuccess(data.id)
        else onError(data.error || 'unknown')
      })
      .catch(() => viaBackground())
  }

  function formatSize(bytes) {
    if (!bytes) return ''
    const u = ['B', 'KB', 'MB', 'GB']
    let i = 0, n = bytes
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n.toFixed(1)} ${u[i]}`
  }

  // ── Messages from background ──────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'intercept_detected') {
      console.log('[LDM] intercept_detected:', msg.contentType, msg.url)
      showInterceptBar(msg.url, msg.contentType, msg.size)
    }
    if (msg.type === 'media_detected') {
      console.log('[LDM] media_detected:', msg.url, 'frame:', location.href)
      seenUrls.add(msg.url)
      const videos = Array.from(document.querySelectorAll('video'))
      const target = videos.find(v => v.offsetWidth > 100) || videos[0]
      if (target) {
        // injectVideoButton handles both: update URL on existing button, or inject new one
        injectVideoButton(target, msg.url)
      } else {
        console.log('[LDM] no <video> in this frame yet')
      }
    }
  })

  // ── DOM observation + initial scans ──────────────────────────────────────────

  let scanTimer = null
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer)
    scanTimer = setTimeout(() => { scanVideos(); scanLinks() }, 300)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  window.addEventListener('popstate', () => setTimeout(() => { scanVideos(); scanLinks() }, 800))
  document.addEventListener('yt-navigate-finish', () => setTimeout(() => { scanVideos(); scanLinks() }, 800))

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { scanVideos(); scanLinks() })
  } else {
    scanVideos()
    scanLinks()
  }
})()
