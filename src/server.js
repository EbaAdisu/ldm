import express from 'express'
import { WebSocketServer } from 'ws'
import cors from 'cors'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import db from './database.js'
import {
  addDownload, pauseDownload, resumeDownload, cancelDownload,
  events, startAria2, updateAria2Settings
} from './downloader.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC    = join(__dirname, '../public')
const EXT_DIR   = join(__dirname, '../extension')

export async function startServer(port) {
  const app    = express()
  const server = createServer(app)
  const wss    = new WebSocketServer({ server })

  app.use(cors({ origin: '*' }))
  app.use(express.json())

  // ── Frontend & Extension static files ──────────────────────────────────────
  app.use(express.static(PUBLIC))
  app.use('/extension-files', express.static(EXT_DIR))

  // ── Downloads ───────────────────────────────────────────────────────────────
  app.get('/api/downloads', (req, res) => {
    const rows = db.prepare(`SELECT * FROM downloads ORDER BY created_at DESC`).all()
    res.json(rows)
  })

  app.post('/api/downloads', async (req, res) => {
    const { url, engine, referer, cookies } = req.body
    if (!url?.trim()) return res.status(400).json({ error: 'URL required' })
    try {
      const id = await addDownload(url.trim(), { forceEngine: engine, referer, cookies })
      res.json({ id })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.patch('/api/downloads/:id', async (req, res) => {
    const { id } = req.params
    const { action } = req.body
    try {
      if (action === 'pause')  await pauseDownload(id)
      else if (action === 'resume') await resumeDownload(id)
      else if (action === 'cancel') await cancelDownload(id)
      else return res.status(400).json({ error: 'Invalid action' })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.delete('/api/downloads/:id', async (req, res) => {
    await cancelDownload(req.params.id).catch(() => {})
    db.prepare(`DELETE FROM downloads WHERE id = ?`).run(req.params.id)
    res.json({ ok: true })
  })

  // ── Settings ────────────────────────────────────────────────────────────────
  app.get('/api/settings', (req, res) => {
    const rows = db.prepare(`SELECT key, value FROM settings`).all()
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])))
  })

  app.post('/api/settings', async (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value))
    }
    await updateAria2Settings()
    res.json({ ok: true })
  })

  // ── Extension info ──────────────────────────────────────────────────────────
  app.get('/api/extension-info', (req, res) => {
    res.json({ path: EXT_DIR, port: port })
  })

  // ── WebSocket ────────────────────────────────────────────────────────────────
  const clients = new Set()

  wss.on('connection', (ws) => {
    clients.add(ws)

    // Send current download list on connect
    const current = db.prepare(`SELECT * FROM downloads ORDER BY created_at DESC`).all()
    ws.send(JSON.stringify({ type: 'init', downloads: current }))

    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => clients.delete(ws))
  })

  function broadcast(data) {
    const msg = JSON.stringify(data)
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(msg)
    }
  }

  events.on('progress', data => broadcast({ type: 'progress', ...data }))
  events.on('added',    data => broadcast({ type: 'added',    ...data }))
  events.on('error',    data => broadcast({ type: 'error',    ...data }))

  // ── Start aria2 ─────────────────────────────────────────────────────────────
  await startAria2()

  return new Promise((resolve, reject) => {
    server.listen(port, (err) => {
      if (err) reject(err)
      else resolve(server)
    })
  })
}
