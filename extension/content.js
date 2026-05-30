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

  function injectVideoButton(video, overrideUrl = null) {
    if (injectedVideos.has(video)) return
    if (video.offsetWidth < 100) return
    injectedVideos.add(video)
    console.log('[LDM] injecting button on video, overrideUrl:', overrideUrl, 'src:', video.src || video.currentSrc)

    const btn = document.createElement('button')
    btn.className = 'ldm-btn'
    btn.innerHTML = '<span>⬇</span> LDM'
    btn.title = 'Download with LDM'

    // Attach to body — completely outside the video player's DOM tree.
    // This means YouTube/Vimeo/etc. overflow:hidden, pointer-event overlays,
    // and z-index stacking contexts cannot block or clip the button.
    document.body.appendChild(btn)

    function reposition() {
      const r = video.getBoundingClientRect()
      // Hide when video is off-screen or invisible
      if (r.width < 10 || r.height < 10 || r.bottom < 0 || r.top > window.innerHeight) {
        btn.style.opacity = '0'
        btn.style.pointerEvents = 'none'
        return
      }
      btn.style.opacity = '1'
      btn.style.pointerEvents = ''
      // position: fixed uses viewport coords — getBoundingClientRect gives exactly that
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
      // Prefer the intercepted stream URL (e.g. .m3u8) over the blob/element src
      const src = overrideUrl || getVideoSrc(video) || window.location.href
      console.log('[LDM] download clicked, sending URL:', src)
      sendDownload(src, btn)
    })
  }

  function scanVideos() {
    const videos = document.querySelectorAll('video')
    console.log('[LDM] scanning for videos, found:', videos.length, 'on', location.href)
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
      console.log('[LDM] intercept_detected:', msg.contentType, msg.url)
      showInterceptBar(msg.url, msg.contentType, msg.size)
    }
    if (msg.type === 'media_detected') {
      console.log('[LDM] media_detected:', msg.url, 'on frame:', location.href)
      if (seenUrls.has(msg.url)) return
      seenUrls.add(msg.url)
      // Pass the real stream URL as override so the button downloads it directly
      const videos = Array.from(document.querySelectorAll('video'))
      const target = videos.find(v => !injectedVideos.has(v) && v.offsetWidth > 100) || videos[0]
      if (target) {
        injectVideoButton(target, msg.url)
      } else {
        console.log('[LDM] media detected but no <video> element found in this frame')
      }
    }
  })

  // ── Observation & initial scans ───────────────────────────────────────────────

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
