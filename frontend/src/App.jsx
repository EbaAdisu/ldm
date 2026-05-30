import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar.jsx'
import DownloadList from './components/DownloadList.jsx'
import AddDownload from './components/AddDownload.jsx'
import Settings from './components/Settings.jsx'
import ExtensionPage from './components/ExtensionPage.jsx'
import './App.css'

const API = ''  // same origin

export default function App() {
  const [page, setPage]           = useState('downloads')
  const [downloads, setDownloads] = useState([])
  const [showAdd, setShowAdd]     = useState(false)
  const [settings, setSettings]   = useState({})
  const wsRef = useRef(null)

  // Fetch settings
  useEffect(() => {
    fetch(`${API}/api/settings`).then(r => r.json()).then(setSettings).catch(() => {})
  }, [])

  // WebSocket for live updates
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)

      if (msg.type === 'init') {
        setDownloads(msg.downloads)
        return
      }

      if (msg.type === 'added') {
        setDownloads(prev => [
          { id: msg.id, url: msg.url, engine: msg.engine, status: 'pending',
            downloaded: 0, size: 0, created_at: Date.now() / 1000 },
          ...prev
        ])
        return
      }

      if (msg.type === 'progress') {
        setDownloads(prev => prev.map(d =>
          d.id === msg.id ? { ...d, ...msg } : d
        ))
      }
    }

    ws.onclose = () => {
      // Reconnect after 2s
      setTimeout(() => wsRef.current?.readyState > 1 && window.location.reload(), 2000)
    }

    return () => ws.close()
  }, [])

  const addDownload = useCallback(async (url, engine) => {
    await fetch(`${API}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, engine }),
    })
    setShowAdd(false)
  }, [])

  const doAction = useCallback(async (id, action) => {
    if (action === 'delete') {
      await fetch(`${API}/api/downloads/${id}`, { method: 'DELETE' })
      setDownloads(prev => prev.filter(d => d.id !== id))
    } else {
      await fetch(`${API}/api/downloads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    }
  }, [])

  const saveSettings = useCallback(async (newSettings) => {
    await fetch(`${API}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings),
    })
    setSettings(s => ({ ...s, ...newSettings }))
  }, [])

  const active    = downloads.filter(d => ['downloading','pending','paused'].includes(d.status))
  const completed = downloads.filter(d => d.status === 'completed')
  const failed    = downloads.filter(d => ['error','cancelled'].includes(d.status))

  const visibleDownloads =
    page === 'downloads' ? [...active, ...failed] :
    page === 'history'   ? completed :
    downloads

  return (
    <div className="app">
      <Sidebar
        page={page}
        onPage={setPage}
        counts={{ active: active.length, completed: completed.length, failed: failed.length }}
      />

      <main className="main">
        <header className="topbar">
          <h1 className="page-title">
            {page === 'downloads' ? 'Downloads' :
             page === 'history'   ? 'History' :
             page === 'settings'  ? 'Settings' :
             'Browser Extension'}
          </h1>
          {(page === 'downloads' || page === 'history') && (
            <button className="btn-add" onClick={() => setShowAdd(true)}>
              + New Download
            </button>
          )}
        </header>

        <div className="content">
          {page === 'downloads' || page === 'history' ? (
            <DownloadList downloads={visibleDownloads} onAction={doAction} />
          ) : page === 'settings' ? (
            <Settings settings={settings} onSave={saveSettings} />
          ) : (
            <ExtensionPage />
          )}
        </div>
      </main>

      {showAdd && (
        <AddDownload onAdd={addDownload} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
