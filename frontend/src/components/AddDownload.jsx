import { useState } from 'react'

export default function AddDownload({ onAdd, onClose }) {
  const [url, setUrl]       = useState('')
  const [engine, setEngine] = useState('auto')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    await onAdd(url.trim(), engine === 'auto' ? undefined : engine)
    setLoading(false)
  }

  // Close on overlay click
  const handleOverlay = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlay}>
      <div className="modal">
        <h2>New Download</h2>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>URL</label>
            <input
              className="form-input"
              type="url"
              placeholder="https://..."
              value={url}
              onChange={e => setUrl(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Engine</label>
            <select className="form-select" value={engine} onChange={e => setEngine(e.target.value)}>
              <option value="auto">Auto-detect (recommended)</option>
              <option value="aria2">aria2 — fast HTTP/FTP (multi-segment)</option>
              <option value="ytdlp">yt-dlp — YouTube / social media video</option>
            </select>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !url.trim()}>
              {loading ? 'Adding...' : 'Download'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
