const LDM_URL = 'http://localhost:6543'

function formatBytes(b) {
  if (!b) return ''
  const u = ['B','KB','MB','GB']
  let i = 0, n = b
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${u[i]}`
}

function getPercent(dl) {
  if (dl.status === 'completed') return 100
  if (dl.percent) return dl.percent
  if (dl.size > 0) return Math.min(100, Math.round(dl.downloaded / dl.size * 100))
  return 0
}

function renderList(downloads) {
  const list = document.getElementById('list')
  if (!downloads.length) {
    list.innerHTML = '<div class="empty">No downloads yet</div>'
    return
  }

  const sorted = downloads.slice().sort((a, b) => b.created_at - a.created_at).slice(0, 12)

  list.innerHTML = sorted.map(dl => {
    const title = dl.title || dl.filename || dl.url.split('/').pop().split('?')[0] || dl.url
    const pct   = getPercent(dl)
    const size  = dl.size > 0 ? `${formatBytes(dl.downloaded)} / ${formatBytes(dl.size)}` : ''
    const showBar = ['downloading','paused','pending'].includes(dl.status) || dl.status === 'completed'
    return `
      <div class="item">
        <div class="item-title" title="${escHtml(dl.url)}">${escHtml(title)}</div>
        <div class="item-meta">
          <span class="badge badge-${dl.status}">${dl.status}</span>
          ${size ? `<span style="font-size:11px;color:#64748b">${size}</span>` : ''}
        </div>
        ${showBar ? `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
      </div>
    `
  }).join('')
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

async function loadDownloads() {
  try {
    const res  = await fetch(`${LDM_URL}/api/downloads`)
    const data = await res.json()
    renderList(data)
  } catch {
    document.getElementById('list').innerHTML =
      '<div class="empty" style="color:#ef4444">LDM not running<br><small>Run: ldm</small></div>'
  }
}

async function addDownload(url) {
  const res = await fetch(`${LDM_URL}/api/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error(await res.text())
}

// ── Events ───────────────────────────────────────────────────────────────────

document.getElementById('add-btn').addEventListener('click', async () => {
  const input = document.getElementById('url-input')
  const url = input.value.trim()
  if (!url) return
  const btn = document.getElementById('add-btn')
  btn.textContent = '...'
  try {
    await addDownload(url)
    input.value = ''
    btn.textContent = '✓'
    setTimeout(() => { btn.textContent = 'Go' }, 1500)
    loadDownloads()
  } catch {
    btn.textContent = '!'
    setTimeout(() => { btn.textContent = 'Go' }, 1500)
  }
})

document.getElementById('url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-btn').click()
})

// Initial load + poll
loadDownloads()
setInterval(loadDownloads, 2000)
