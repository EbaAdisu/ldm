;(function () {
  'use strict'

  const injectedVideos = new WeakSet()
  const injectedLinks  = new WeakSet()
  const seenUrls       = new Set()

  // Extensions that mark an <a href> as a downloadable file
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
    return (
      video.src ||
      video.currentSrc ||
      video.querySelector('source')?.src ||
      video.getAttribute('data-src') ||
      video.getAttribute('data-url') ||
      null
    )
  }

  function injectVideoButton(video) {
    if (injectedVideos.has(video)) return
    if (video.offsetWidth < 100) return  // skip hidden/tiny players
    injectedVideos.add(video)

    const wrap = video.parentElement
    if (!wrap) return
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative'

    const btn = document.createElement('button')
    btn.className = 'ldm-btn'
    btn.innerHTML = '<span>⬇</span> LDM'
    btn.title = 'Download with LDM'

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      const src = getVideoSrc(video) || window.location.href
      sendDownload(src, btn)
    })

    wrap.appendChild(btn)

    const ro = new ResizeObserver(() => {
      const vr = video.getBoundingClientRect()
      const pr = wrap.getBoundingClientRect()
      btn.style.top   = `${vr.top - pr.top + 8}px`
      btn.style.right = `${pr.right - vr.right + 8}px`
    })
    ro.observe(video)
    ro.disconnect()  // trigger once, then re-observe
    new ResizeObserver(() => {
      const vr = video.getBoundingClientRect()
      const pr = wrap.getBoundingClientRect()
      btn.style.top   = `${vr.top - pr.top + 8}px`
      btn.style.right = `${pr.right - vr.right + 8}px`
    }).observe(video)
  }

  function scanVideos() {
    document.querySelectorAll('video').forEach(injectVideoButton)
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

  // ── Layer 1: intercept bar (triggered by background's Content-Type sniff) ────

  function showInterceptBar(url, contentType, size) {
    // One bar at a time per URL
    if (seenUrls.has(url)) return
    seenUrls.add(url)

    const existing = document.getElementById('ldm-intercept-bar')
    if (existing) existing.remove()

    const ext      = url.split('.').pop().split('?')[0].toUpperCase().slice(0, 5)
    const sizeStr  = size > 0 ? ` · ${formatSize(size)}` : ''
    const typeStr  = contentType.split('/')[1]?.split(';')[0] || ext

    const bar      = document.createElement('div')
    bar.id         = 'ldm-intercept-bar'
    bar.innerHTML  = `
      <span class="ldm-bar-icon">⬇</span>
      <span class="ldm-bar-text">
        LDM detected a <strong>${typeStr.toUpperCase()}</strong> file${sizeStr}
      </span>
      <button class="ldm-bar-dl">Download with LDM</button>
      <button class="ldm-bar-close" title="Dismiss">✕</button>
    `

    bar.querySelector('.ldm-bar-dl').onclick = () => {
      sendDownload(url, bar.querySelector('.ldm-bar-dl'))
      setTimeout(() => bar.remove(), 1500)
    }
    bar.querySelector('.ldm-bar-close').onclick = () => bar.remove()

    document.body.appendChild(bar)
    setTimeout(() => bar?.remove(), 12_000)
  }

  // ── Shared: send URL to background → backend ─────────────────────────────────

  function sendDownload(url, el, isLink = false) {
    const original = el.innerHTML
    el.innerHTML   = isLink ? '...' : '⏳ Adding...'

    chrome.runtime.sendMessage({ type: 'download', url }, (res) => {
      if (res?.ok) {
        el.innerHTML = isLink ? '✓' : '✓ Added'
        el.classList.add(isLink ? 'ldm-link-btn--done' : 'ldm-btn--done')
        setTimeout(() => {
          el.innerHTML = original
          el.classList.remove('ldm-link-btn--done', 'ldm-btn--done')
        }, 3000)
      } else {
        el.innerHTML = isLink ? '!' : '✗ Error'
        setTimeout(() => { el.innerHTML = original }, 2000)
      }
    })
  }

  function formatSize(bytes) {
    if (!bytes) return ''
    const u = ['B', 'KB', 'MB', 'GB']
    let i = 0, n = bytes
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n.toFixed(1)} ${u[i]}`
  }

  // ── Message listener (from background.js) ────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'intercept_detected') {
      showInterceptBar(msg.url, msg.contentType, msg.size)
    }
    if (msg.type === 'media_detected') {
      // A media URL was seen in network traffic — find the video player for it
      if (seenUrls.has(msg.url)) return
      seenUrls.add(msg.url)
      const videos = Array.from(document.querySelectorAll('video'))
      const target = videos.find(v => !injectedVideos.has(v) && v.offsetWidth > 100)
      if (target) injectVideoButton(target)
    }
  })

  // ── Observation & initial scans ───────────────────────────────────────────────

  const observer = new MutationObserver(() => {
    scanVideos()
    scanLinks()
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
