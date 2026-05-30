;(function () {
  'use strict'

  const injectedVideos  = new WeakSet()
  const injectedLinks   = new WeakSet()
  const seenUrls        = new Set()
  const videoStreamUrls = new WeakMap()  // video → latest intercepted stream URL

  const FILE_EXTS = new Set([
    'mp4','webm','mkv','avi','mov','flv','m4v','wmv','ts',
    'mp3','ogg','wav','aac','flac','opus','m4a',
    'zip','rar','7z','tar','gz','bz2','xz','iso','dmg',
    'exe','deb','rpm','apk','msi',
    'pdf','epub','mobi',
    'm3u8','mpd',
  ])

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function getVideoSrc(video) {
    const src = video.src || video.currentSrc ||
      video.querySelector('source')?.src ||
      video.getAttribute('data-src') ||
      video.getAttribute('data-url') || null
    return src && !src.startsWith('blob:') ? src : null
  }

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '—'
    const u = ['B', 'KB', 'MB', 'GB']
    let i = 0, n = bytes
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n.toFixed(1)} ${u[i]}`
  }

  // Guess quality label from a URL string
  function guessQuality(url) {
    if (!url) return null
    if (url.includes('fullhd=1')) return '1080p'
    if (url.includes('fullhd=0')) return 'SD'
    const m = url.match(/[_\-x](\d{3,4}p)/i)
    if (m) return m[1].toLowerCase()
    try {
      const params = new URL(url).searchParams
      const q = params.get('quality') || params.get('res') || params.get('resolution')
      if (q) return q.includes('p') ? q : `${q}p`
    } catch {}
    return null
  }

  // Build display title from the parent page URL slug (Option B)
  function titleFromPageUrl(pageUrl) {
    try {
      const pathname = new URL(pageUrl).pathname.replace(/\/$/, '').replace(/#.*$/, '')
      const slug = pathname.split('/').filter(Boolean).pop()
      if (!slug) return null

      let parts   = slug.split('-').filter(Boolean)
      let episode = null
      let subType = null

      const epIdx = parts.findIndex(p => p === 'episode')
      if (epIdx !== -1 && /^\d+$/.test(parts[epIdx + 1] ?? '')) {
        episode = `Ep ${parts[epIdx + 1]}`
        parts.splice(epIdx, 2)
      }

      // Remove season number from display (it stays in the title words)
      const snIdx = parts.findIndex(p => p === 'season')
      if (snIdx !== -1 && /^\d+$/.test(parts[snIdx + 1] ?? '')) {
        parts[snIdx]     = `Season`
        parts[snIdx + 1] = parts[snIdx + 1]
      }

      const LANGS = ['english','japanese','french','spanish','german','portuguese']
      const subIdx = parts.findIndex(p => p === 'subbed' || p === 'dubbed')
      if (subIdx !== -1) {
        const prev    = parts[subIdx - 1] ?? ''
        const hasLang = LANGS.includes(prev)
        const type    = parts[subIdx] === 'subbed' ? 'Subbed' : 'Dubbed'
        subType = hasLang
          ? `(${prev.charAt(0).toUpperCase() + prev.slice(1)} ${type})`
          : `(${type})`
        parts.splice(hasLang ? subIdx - 1 : subIdx, hasLang ? 2 : 1)
      }

      const title = parts
        .filter(p => p.length > 0)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ')

      return [title, episode, subType].filter(Boolean).join(' ') || null
    } catch { return null }
  }

  // ── Quality detection ─────────────────────────────────────────────────────────

  function detectQualities(video) {
    const sources = []

    // Strategy A — VideoJS player API (wco.tv and most anime sites)
    try {
      const players = window.videojs?.players ?? {}
      for (const player of Object.values(players)) {
        const srcs = player.currentSources?.() ?? []
        for (const s of srcs) {
          if (s.src && !s.src.startsWith('blob:')) {
            sources.push({
              url:   s.src,
              label: s.label || s.res || guessQuality(s.src) || 'Default',
              type:  s.type || '',
            })
          }
        }
        // VideoJS quality levels plugin
        const ql = player.qualityLevels?.()
        if (ql?.length) {
          for (let i = 0; i < ql.length; i++) {
            const lv = ql[i]
            const src = lv.src || lv.uri
            if (src && !src.startsWith('blob:') && !sources.find(x => x.url === src)) {
              sources.push({
                url:   src,
                label: lv.height ? `${lv.height}p` : guessQuality(src) || `Q${i + 1}`,
              })
            }
          }
        }
      }
    } catch {}

    // Strategy B — <source> elements
    if (sources.length === 0) {
      video.querySelectorAll('source').forEach(s => {
        const src = s.src || s.getAttribute('src')
        if (src && !src.startsWith('blob:')) {
          sources.push({
            url:   src,
            label: s.getAttribute('label') || s.getAttribute('res') || guessQuality(src) || 'Default',
            type:  s.type || '',
          })
        }
      })
    }

    // Strategy C — network-intercepted URL stored in videoStreamUrls
    const streamUrl = videoStreamUrls.get(video)
    if (streamUrl && !sources.find(x => x.url === streamUrl)) {
      sources.unshift({
        url:   streamUrl,
        label: guessQuality(streamUrl) || '1080p',
      })
    }

    // Strategy D — video element src fallback
    if (sources.length === 0) {
      const src = getVideoSrc(video)
      if (src) sources.push({ url: src, label: guessQuality(src) || 'Default' })
    }

    // Deduplicate by URL
    const seen = new Set()
    return sources.filter(s => { if (seen.has(s.url)) return false; seen.add(s.url); return true })
  }

  // ── Dropdown ──────────────────────────────────────────────────────────────────

  function openDropdown(btn, video) {
    // Close any existing dropdown
    document.getElementById('ldm-dropdown')?.remove()

    const sources = detectQualities(video)
    const pageUrl = document.referrer || (window.self !== window.top ? null : window.location.href)
    const title   = (pageUrl && titleFromPageUrl(pageUrl)) || 'Video'

    if (sources.length === 0) {
      // Nothing detected — download page URL via yt-dlp
      const fallback = videoStreamUrls.get(video) || window.location.href
      triggerDownload(fallback, btn, null, null, pageUrl)
      return
    }

    if (sources.length === 1) {
      // Single quality — download directly, no dropdown needed
      const src = sources[0].url
      triggerDownload(src, btn, sources[0].label, pageUrl)
      return
    }

    const drop = document.createElement('div')
    drop.id = 'ldm-dropdown'
    drop.innerHTML = `
      <div class="ldm-drop-title" title="${escHtml(pageUrl || '')}">${escHtml(title)}</div>
      ${sources.map((s, i) => `
        <div class="ldm-drop-item" data-idx="${i}">
          <span class="ldm-drop-dot">${i === 0 ? '●' : '○'}</span>
          <span class="ldm-drop-label">${escHtml(s.label)}</span>
          <span class="ldm-drop-size" data-size-idx="${i}">…</span>
        </div>
      `).join('')}
    `
    document.body.appendChild(drop)

    // Position relative to button
    positionDropdown(drop, btn)

    // Click handlers — each row downloads that quality
    drop.querySelectorAll('.ldm-drop-item').forEach((row, i) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation()
        drop.remove()
        triggerDownload(sources[i].url, btn, sources[i].label, pageUrl)
      })
    })

    // Close on outside click or Escape
    const close = (e) => {
      if (!drop.contains(e.target) && e.target !== btn) { drop.remove() }
    }
    const closeKey = (e) => { if (e.key === 'Escape') drop.remove() }
    setTimeout(() => {
      document.addEventListener('click',   close)
      document.addEventListener('keydown', closeKey)
    }, 10)
    drop.addEventListener('remove', () => {
      document.removeEventListener('click',   close)
      document.removeEventListener('keydown', closeKey)
    })

    // Fetch file sizes from background (HEAD requests per quality URL)
    chrome.runtime.sendMessage({
      type:    'get_quality_sizes',
      sources: sources.map(s => ({ url: s.url, label: s.label })),
      referer: location.href,
    }, (res) => {
      if (!res?.sources || !document.getElementById('ldm-dropdown')) return
      res.sources.forEach((s, i) => {
        const el = drop.querySelector(`[data-size-idx="${i}"]`)
        if (el) el.textContent = s.sizeStr || '—'
      })
    })
  }

  function positionDropdown(drop, btn) {
    const br = btn.getBoundingClientRect()
    drop.style.right = `${window.innerWidth - br.right}px`
    drop.style.top   = `${br.bottom + 6}px`
    // Flip above if it would go off-screen bottom
    requestAnimationFrame(() => {
      const dr = drop.getBoundingClientRect()
      if (dr.bottom > window.innerHeight - 8) {
        drop.style.top = `${br.top - dr.height - 6}px`
      }
    })
  }

  // ── Core: inject button on video ──────────────────────────────────────────────

  function injectVideoButton(video, streamUrl = null) {
    if (streamUrl) {
      videoStreamUrls.set(video, streamUrl)
      console.log('[LDM] stream URL updated:', streamUrl)
    }

    if (injectedVideos.has(video)) return
    if (video.offsetWidth < 100) return
    injectedVideos.add(video)

    const btn = document.createElement('button')
    btn.className   = 'ldm-btn'
    btn.innerHTML   = '<span class="ldm-btn-icon">⬇</span> LDM <span class="ldm-btn-arrow">▾</span>'
    btn.title       = 'Download with LDM'
    btn.dataset.ldmId = Math.random().toString(36).slice(2)  // fingerprint like IDM
    document.body.appendChild(btn)

    function reposition() {
      const r = video.getBoundingClientRect()
      if (r.width < 10 || r.height < 10 || r.bottom < 0 || r.top > window.innerHeight) {
        btn.style.opacity = '0'; btn.style.pointerEvents = 'none'; return
      }
      btn.style.opacity = '1'; btn.style.pointerEvents = ''
      btn.style.top   = `${r.top   + 8}px`
      btn.style.right = `${window.innerWidth - r.right + 8}px`
    }

    reposition()
    window.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition, { passive: true })
    new ResizeObserver(reposition).observe(video)

    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
      // If dropdown already open, close it
      if (document.getElementById('ldm-dropdown')) {
        document.getElementById('ldm-dropdown').remove()
        return
      }
      openDropdown(btn, video)
    })

    console.log('[LDM] button injected in', location.href)
  }

  function scanVideos() {
    const videos = document.querySelectorAll('video')
    console.log('[LDM] scan:', videos.length, 'video(s) on', location.href)
    videos.forEach(v => injectVideoButton(v))
  }

  // ── Send download ─────────────────────────────────────────────────────────────

  function triggerDownload(url, btn, quality = null, pageUrl = null) {
    const original    = btn.innerHTML
    btn.innerHTML     = '<span class="ldm-btn-icon">⏳</span> Adding…'

    const engine  = 'aria2'
    const referer = location.href

    function onSuccess(id) {
      console.log('[LDM] added, id:', id)
      btn.innerHTML = '<span class="ldm-btn-icon">✓</span> Added'
      btn.classList.add('ldm-btn--done')
      setTimeout(() => { btn.innerHTML = original; btn.classList.remove('ldm-btn--done') }, 3000)
    }

    function onError(reason) {
      console.error('[LDM] failed:', reason)
      btn.innerHTML = '<span class="ldm-btn-icon">✗</span> Failed'
      setTimeout(() => { btn.innerHTML = original }, 2500)
    }

    chrome.runtime.sendMessage({ type: 'get_cookies', url }, (res) => {
      const cookies = res?.cookies || ''
      console.log('[LDM] download:', url, 'quality:', quality, 'pageUrl:', pageUrl)

      const payload = { url, engine, referer, cookies, quality, pageUrl }

      function viaBackground() {
        if (!chrome.runtime?.id) { onError('extension context gone'); return }
        chrome.runtime.sendMessage({ type: 'download', ...payload }, r => {
          if (chrome.runtime.lastError) onError(chrome.runtime.lastError.message)
          else if (r?.ok) onSuccess(r.id)
          else onError(r?.error || 'background error')
        })
      }

      if (location.protocol === 'https:') { viaBackground(); return }

      fetch('http://localhost:6543/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(r => r.json())
        .then(data => { if (data.id) onSuccess(data.id); else onError(data.error || 'unknown') })
        .catch(() => viaBackground())
    })
  }

  // ── Link button (download links on page) ──────────────────────────────────────

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
    btn.title     = `Download .${ext} with LDM`
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation()
      triggerDownload(anchor.href, btn, null, window.location.href)
    })
    anchor.insertAdjacentElement('afterend', btn)
  }

  function scanLinks() {
    document.querySelectorAll('a[href]').forEach(injectLinkButton)
  }

  // ── Intercept bar ─────────────────────────────────────────────────────────────

  function showInterceptBar(url, contentType, size) {
    if (seenUrls.has(url)) return
    seenUrls.add(url)
    document.getElementById('ldm-intercept-bar')?.remove()

    const sizeStr = size > 0 ? ` · ${formatSize(size)}` : ''
    const typeStr = contentType.split('/')[1]?.split(';')[0]?.toUpperCase() ||
                    url.split('.').pop().split('?')[0].toUpperCase().slice(0, 5)

    const bar = document.createElement('div')
    bar.id = 'ldm-intercept-bar'
    bar.innerHTML = `
      <span class="ldm-bar-icon">⬇</span>
      <span class="ldm-bar-text">LDM detected a <strong>${typeStr}</strong> file${sizeStr}</span>
      <button class="ldm-bar-dl">Download with LDM</button>
      <button class="ldm-bar-close" title="Dismiss">✕</button>
    `
    const dlBtn = bar.querySelector('.ldm-bar-dl')
    dlBtn.onclick = () => {
      triggerDownload(url, dlBtn, null, document.referrer || null)
      setTimeout(() => bar.remove(), 1500)
    }
    bar.querySelector('.ldm-bar-close').onclick = () => bar.remove()
    document.body.appendChild(bar)
    setTimeout(() => bar?.remove(), 12_000)
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
      if (target) injectVideoButton(target, msg.url)
      else console.log('[LDM] no <video> found in this frame yet')
    }
  })

  // ── DOM observation ───────────────────────────────────────────────────────────

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
