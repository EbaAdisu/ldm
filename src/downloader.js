import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { createWriteStream, mkdirSync, renameSync, rmSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import db from './database.js'
import { v4 as uuid } from 'uuid'

export const events = new EventEmitter()

// ── Constants ────────────────────────────────────────────────────────────────

// Extensions that mean it's a direct file → aria2 is the right engine
const DIRECT_FILE_EXTS = new Set([
  'mp4','webm','mkv','avi','mov','flv','m4v','wmv','ts','m2ts',
  'mp3','ogg','wav','aac','flac','opus','m4a','wma',
  'zip','rar','7z','tar','gz','bz2','xz','iso','dmg',
  'exe','deb','rpm','apk','msi',
  'pdf','epub','mobi','cbr','cbz',
  'm3u8','mpd',
])

const ARIA2_PORT   = 6800
const ARIA2_SECRET = `ldm_${Math.random().toString(36).slice(2, 10)}`

// ── State ────────────────────────────────────────────────────────────────────

let aria2Process   = null
let aria2Available = false
const ytdlpProcs   = new Map()  // id → ChildProcess
const pollTimers   = new Map()  // id → setInterval handle

// ── aria2 daemon ─────────────────────────────────────────────────────────────

export async function startAria2() {
  return new Promise((resolve) => {
    const s = getSettings()
    aria2Process = spawn('aria2c', [
      '--enable-rpc',
      `--rpc-listen-port=${ARIA2_PORT}`,
      `--rpc-secret=${ARIA2_SECRET}`,
      '--rpc-allow-origin-all',
      '--quiet=true',
      `--dir=${s.downloadDir}`,
      `--split=${s.segments}`,
      `--max-connection-per-server=${s.connectionsPerServer}`,
      `--min-split-size=1M`,
      `--max-concurrent-downloads=${s.maxConcurrent}`,
      ...(s.speedLimit !== '0' ? [`--max-overall-download-limit=${s.speedLimit}K`] : []),
    ])
    aria2Process.on('error', () => { aria2Available = false; resolve(false) })
    setTimeout(() => { aria2Available = true; resolve(true) }, 1200)
  })
}

// Call this after user saves settings so aria2 picks up new values immediately
export async function updateAria2Settings() {
  if (!aria2Available) return
  const s = getSettings()
  try {
    await aria2Rpc('changeGlobalOption', [{
      'max-concurrent-downloads': s.maxConcurrent,
      'max-overall-download-limit': s.speedLimit !== '0' ? `${s.speedLimit}K` : '0',
    }])
  } catch { /* aria2 not running, ignore */ }
}

async function aria2Rpc(method, params = []) {
  const res = await fetch(`http://localhost:${ARIA2_PORT}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'ldm',
      method: `aria2.${method}`,
      params: [`token:${ARIA2_SECRET}`, ...params],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.result
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSetting(key, fallback = '') {
  return db.prepare(`SELECT value FROM settings WHERE key=?`).get(key)?.value ?? fallback
}

function getSettings() {
  return {
    downloadDir:          getSetting('downloadDir', join(process.env.HOME, 'Downloads')),
    segments:             getSetting('segments', '16'),
    connectionsPerServer: getSetting('connectionsPerServer', '4'),
    maxConcurrent:        getSetting('maxConcurrent', '3'),
    speedLimit:           getSetting('speedLimit', '0'),
  }
}

function getDownloadDir() {
  return getSetting('downloadDir', join(process.env.HOME, 'Downloads', 'ldm'))
}

function getTempDir(id) {
  return join(getDownloadDir(), '.temp', id)
}

// Move a completed file out of its temp dir into the final download dir.
// Returns the final filename actually written.
function moveToFinal(tempDir, downloadDir, preferredName) {
  let files
  try {
    files = readdirSync(tempDir).filter(f => !f.endsWith('.aria2') && !f.startsWith('.'))
  } catch { return preferredName || 'download' }

  if (!files.length) return preferredName || 'download'

  const srcName  = files[0]
  let destName   = preferredName || srcName
  let destPath   = join(downloadDir, destName)

  // Avoid clobbering an existing file — append (1), (2), …
  if (existsSync(destPath)) {
    const dot  = destName.lastIndexOf('.')
    const base = dot > 0 ? destName.slice(0, dot) : destName
    const ext  = dot > 0 ? destName.slice(dot)    : ''
    let i = 1
    while (existsSync(join(downloadDir, `${base} (${i})${ext}`))) i++
    destName = `${base} (${i})${ext}`
    destPath = join(downloadDir, destName)
  }

  try {
    renameSync(join(tempDir, srcName), destPath)
    rmSync(tempDir, { recursive: true, force: true })
  } catch { /* cross-device rename not possible — ignore, file stays in temp */ }

  return destName
}

// Delete a temp dir (on cancel / error cleanup)
function cleanTempDir(id) {
  try { rmSync(getTempDir(id), { recursive: true, force: true }) } catch {}
}

// Detect whether to use aria2 (direct file) or yt-dlp (webpage with embedded media).
// Does a HEAD request to read Content-Type — no hardcoded site list.
async function detectEngine(url) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, {
      method: 'HEAD',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LDM/1.0)' },
    })
    clearTimeout(t)

    const ct = (res.headers.get('content-type') || '').toLowerCase()

    // Direct binary/media file → aria2
    if (
      ct.startsWith('video/') ||
      ct.startsWith('audio/') ||
      ct.includes('octet-stream') ||
      ct.includes('zip') || ct.includes('rar') || ct.includes('x-tar') ||
      ct.includes('pdf') || ct.includes('iso') || ct.includes('torrent')
    ) return 'aria2'

    // HTML page → yt-dlp to extract embedded media
    if (ct.startsWith('text/html')) return 'ytdlp'

  } catch { /* HEAD failed or timed out */ }

  // Fall back to URL extension
  try {
    const ext = new URL(url).pathname.split('.').pop().split('?')[0].toLowerCase()
    // HLS/DASH manifests must go to yt-dlp — aria2 would just download the text manifest
    if (ext === 'm3u8' || ext === 'mpd') return 'ytdlp'
    if (DIRECT_FILE_EXTS.has(ext)) return 'aria2'
  } catch {}

  // Default: try yt-dlp (handles most video sites); downloader will fall back if needed
  return 'ytdlp'
}

function setStatus(id, status, extra = {}) {
  const fields = Object.entries({ status, ...extra })
    .map(([k]) => `${k} = ?`).join(', ')
  db.prepare(`UPDATE downloads SET ${fields} WHERE id = ?`)
    .run(...Object.values({ status, ...extra }), id)
  events.emit('progress', { id, status, ...extra })
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function addDownload(url, options = {}) {
  const id = uuid()
  const engine = options.forceEngine ?? await detectEngine(url)

  db.prepare(`
    INSERT INTO downloads (id, url, engine, status)
    VALUES (?, ?, ?, 'pending')
  `).run(id, url, engine)

  events.emit('added', { id, url, engine })

  if (engine === 'ytdlp') {
    downloadWithYtdlp(id, url)
  } else if (aria2Available) {
    await downloadWithAria2(id, url)
  } else {
    downloadWithHttp(id, url)
  }

  return id
}

export async function pauseDownload(id) {
  const dl = db.prepare(`SELECT * FROM downloads WHERE id = ?`).get(id)
  if (!dl) return
  if (dl.engine === 'aria2' && dl.aria2_gid) {
    try { await aria2Rpc('pause', [dl.aria2_gid]) } catch {}
  } else if (dl.engine === 'ytdlp') {
    ytdlpProcs.get(id)?.kill('SIGSTOP')
  }
  setStatus(id, 'paused')
}

export async function resumeDownload(id) {
  const dl = db.prepare(`SELECT * FROM downloads WHERE id = ?`).get(id)
  if (!dl) return
  if (dl.engine === 'aria2' && dl.aria2_gid) {
    try { await aria2Rpc('unpause', [dl.aria2_gid]) } catch {}
  } else if (dl.engine === 'ytdlp') {
    ytdlpProcs.get(id)?.kill('SIGCONT')
  }
  setStatus(id, 'downloading')
}

export async function cancelDownload(id) {
  const dl = db.prepare(`SELECT * FROM downloads WHERE id = ?`).get(id)
  if (!dl) return
  if (dl.engine === 'aria2' && dl.aria2_gid) {
    try { await aria2Rpc('remove', [dl.aria2_gid]) } catch {}
  }
  ytdlpProcs.get(id)?.kill()
  ytdlpProcs.delete(id)
  clearInterval(pollTimers.get(id))
  pollTimers.delete(id)
  cleanTempDir(id)
  setStatus(id, 'cancelled')
}

export function cleanup() {
  if (aria2Process) aria2Process.kill()
  for (const proc of ytdlpProcs.values()) proc.kill()
  for (const t of pollTimers.values()) clearInterval(t)
}

// ── aria2 engine ──────────────────────────────────────────────────────────────

async function downloadWithAria2(id, url) {
  try {
    const s       = getSettings()
    const tempDir = getTempDir(id)
    mkdirSync(tempDir, { recursive: true })

    const gid = await aria2Rpc('addUri', [[url], {
      dir:                         tempDir,
      split:                       s.segments,
      'max-connection-per-server': s.connectionsPerServer,
      'min-split-size':            '1M',
    }])
    db.prepare(`UPDATE downloads SET aria2_gid=?, status='downloading' WHERE id=?`).run(gid, id)
    pollAria2(id, gid, tempDir, s.downloadDir)
  } catch (err) {
    setStatus(id, 'error', { error: err.message })
  }
}

function pollAria2(id, gid, tempDir, finalDir) {
  const timer = setInterval(async () => {
    try {
      const s          = await aria2Rpc('tellStatus', [gid])
      const downloaded = parseInt(s.completedLength || 0)
      const size       = parseInt(s.totalLength || 0)
      const speed      = parseInt(s.downloadSpeed || 0)
      const tempPath   = s.files?.[0]?.path || ''
      const tempName   = tempPath.split('/').pop() || ''

      let status = 'downloading'
      if (s.status === 'complete') status = 'completed'
      if (s.status === 'error')    status = 'error'
      if (s.status === 'paused')   status = 'paused'
      if (s.status === 'removed')  { clearInterval(timer); pollTimers.delete(id); return }

      db.prepare(`UPDATE downloads SET downloaded=?, size=?, status=?, filename=?, filepath=? WHERE id=?`)
        .run(downloaded, size, status, tempName, tempPath, id)
      events.emit('progress', { id, downloaded, size, speed, status, filename: tempName })

      if (status === 'completed') {
        clearInterval(timer)
        pollTimers.delete(id)
        // Move out of temp dir into the final download directory
        const finalName = moveToFinal(tempDir, finalDir, tempName)
        const finalPath = join(finalDir, finalName)
        db.prepare(`UPDATE downloads SET filepath=?, filename=?, completed_at=strftime('%s','now') WHERE id=?`)
          .run(finalPath, finalName, id)
        events.emit('progress', { id, status: 'completed', filepath: finalPath, filename: finalName })
      }

      if (status === 'error') {
        clearInterval(timer)
        pollTimers.delete(id)
        cleanTempDir(id)
        db.prepare(`UPDATE downloads SET error=? WHERE id=?`).run(s.errorMessage || 'Unknown error', id)
      }
    } catch {
      clearInterval(timer)
      pollTimers.delete(id)
    }
  }, 1000)
  pollTimers.set(id, timer)
}

// ── yt-dlp engine ─────────────────────────────────────────────────────────────

function downloadWithYtdlp(id, url) {
  // First, get metadata (non-blocking)
  const infoProc = spawn('yt-dlp', ['--dump-json', '--no-playlist', url])
  let infoJson = ''

  infoProc.stdout.on('data', d => { infoJson += d.toString() })
  infoProc.on('close', (code) => {
    if (code === 0) {
      try {
        const info = JSON.parse(infoJson)
        db.prepare(`UPDATE downloads SET title=?, thumbnail=?, filename=?, status='downloading' WHERE id=?`)
          .run(info.title, info.thumbnail, `${info.title}.${info.ext}`, id)
        events.emit('progress', { id, title: info.title, thumbnail: info.thumbnail, status: 'downloading' })
      } catch {}
    }
    _runYtdlp(id, url)
  })
  infoProc.on('error', () => _runYtdlp(id, url))
}

function _runYtdlp(id, url) {
  const finalDir = getDownloadDir()
  const tempDir  = getTempDir(id)
  mkdirSync(tempDir, { recursive: true })
  db.prepare(`UPDATE downloads SET status='downloading' WHERE id=?`).run(id)

  const proc = spawn('yt-dlp', [
    '--newline',
    '-o', join(tempDir, '%(title)s.%(ext)s'),
    '--no-playlist',
    '--merge-output-format', 'mp4',
    url,
  ])

  ytdlpProcs.set(id, proc)

  proc.stdout.on('data', (data) => {
    const line = data.toString().trim()
    const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+)([\w]+)\s+at\s+([\d.]+\s?[\w/]+)/)
    if (m) {
      const percent  = parseFloat(m[1])
      const sizeStr  = m[2] + m[3]
      const speedStr = m[4].trim()
      events.emit('progress', { id, percent, sizeStr, speedStr, status: 'downloading' })
      db.prepare(`UPDATE downloads SET downloaded=? WHERE id=?`).run(Math.round(percent), id)
    }
  })

  proc.stderr.on('data', (data) => {
    const line = data.toString().trim()
    if (line.includes('ERROR')) {
      db.prepare(`UPDATE downloads SET error=? WHERE id=?`).run(line.slice(0, 200), id)
    }
  })

  proc.on('close', (code) => {
    ytdlpProcs.delete(id)
    if (code === 0) {
      // Move completed file from temp to final dir
      const currentFilename = db.prepare(`SELECT filename FROM downloads WHERE id=?`).get(id)?.filename
      const finalName = moveToFinal(tempDir, finalDir, currentFilename)
      const finalPath = join(finalDir, finalName)
      db.prepare(`UPDATE downloads SET status='completed', completed_at=strftime('%s','now'), downloaded=100, filepath=?, filename=? WHERE id=?`)
        .run(finalPath, finalName, id)
      events.emit('progress', { id, status: 'completed', percent: 100, filepath: finalPath, filename: finalName })
    } else if (code !== null) {
      cleanTempDir(id)
      db.prepare(`UPDATE downloads SET status='error' WHERE id=?`).run(id)
      events.emit('progress', { id, status: 'error' })
    }
  })
}

// ── Simple HTTP fallback (no aria2) ──────────────────────────────────────────

function downloadWithHttp(id, url) {
  db.prepare(`UPDATE downloads SET status='downloading' WHERE id=?`).run(id)

  const finalDir = getDownloadDir()
  const tempDir  = getTempDir(id)
  mkdirSync(tempDir, { recursive: true })

  fetch(url).then(async (res) => {
    const filename = getFilenameFromResponse(res, url)
    const tempPath = join(tempDir, filename)
    const total    = parseInt(res.headers.get('content-length') || 0)
    let downloaded = 0

    db.prepare(`UPDATE downloads SET filename=?, filepath=?, size=? WHERE id=?`).run(filename, tempPath, total, id)

    const writer = createWriteStream(tempPath)
    const reader = res.body.getReader()

    const pump = async () => {
      const { done, value } = await reader.read()
      if (done) {
        writer.end()
        const finalName = moveToFinal(tempDir, finalDir, filename)
        const finalPath = join(finalDir, finalName)
        db.prepare(`UPDATE downloads SET status='completed', completed_at=strftime('%s','now'), downloaded=?, filepath=?, filename=? WHERE id=?`)
          .run(total || downloaded, finalPath, finalName, id)
        events.emit('progress', { id, status: 'completed', downloaded: total || downloaded, size: total, filepath: finalPath })
        return
      }
      writer.write(Buffer.from(value))
      downloaded += value.length
      db.prepare(`UPDATE downloads SET downloaded=? WHERE id=?`).run(downloaded, id)
      events.emit('progress', { id, downloaded, size: total, status: 'downloading' })
      pump()
    }

    pump()
  }).catch(err => {
    cleanTempDir(id)
    setStatus(id, 'error', { error: err.message })
  })
}

function getFilenameFromResponse(res, url) {
  const cd = res.headers.get('content-disposition') || ''
  const match = cd.match(/filename\*?=["']?(?:UTF-8'')?([^"';\n]+)/i)
  if (match) return decodeURIComponent(match[1].trim())
  return url.split('/').pop().split('?')[0] || 'download'
}
