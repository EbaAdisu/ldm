import { useState, useEffect } from 'react'

const MIN_SIZE_OPTIONS = [
  { label: 'Off (intercept everything)', value: '0' },
  { label: '500 KB', value: '512000' },
  { label: '1 MB (recommended)', value: '1048576' },
  { label: '5 MB', value: '5242880' },
  { label: '10 MB', value: '10485760' },
  { label: '50 MB', value: '52428800' },
]

export default function Settings({ settings, onSave }) {
  const [form, setForm]   = useState(settings)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setForm(settings) }, [settings])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleSave = async () => {
    await onSave(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ maxWidth: 640 }}>

      {/* ── Download Location ─────────────────────────────────── */}
      <div className="settings-section">
        <h3>Storage</h3>

        <div className="settings-row">
          <div>
            <label>Save location</label>
            <div className="hint">Completed files go here. In-progress parts live in <code style={{color:'var(--accent)'}}>this-folder/.temp/</code></div>
          </div>
          <input
            className="settings-input"
            value={form.downloadDir || ''}
            onChange={e => set('downloadDir', e.target.value)}
            placeholder="~/Downloads/ldm"
          />
        </div>
      </div>

      {/* ── Speed & Segments ──────────────────────────────────── */}
      <div className="settings-section">
        <h3>Download Speed</h3>

        <div className="settings-row">
          <div>
            <label>Segments per file</label>
            <div className="hint">Split each file into N parallel chunks (more = faster)</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              className="settings-input"
              type="range"
              min={1} max={32} step={1}
              value={form.segments || 16}
              onChange={e => set('segments', e.target.value)}
              style={{ width: 120 }}
            />
            <span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: 24 }}>
              {form.segments || 16}
            </span>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <label>Connections per server</label>
            <div className="hint">Parallel TCP connections per segment</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              className="settings-input"
              type="range"
              min={1} max={16} step={1}
              value={form.connectionsPerServer || 4}
              onChange={e => set('connectionsPerServer', e.target.value)}
              style={{ width: 120 }}
            />
            <span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: 24 }}>
              {form.connectionsPerServer || 4}
            </span>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <label>Max concurrent downloads</label>
            <div className="hint">How many files download at the same time</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              className="settings-input"
              type="range"
              min={1} max={10} step={1}
              value={form.maxConcurrent || 3}
              onChange={e => set('maxConcurrent', e.target.value)}
              style={{ width: 120 }}
            />
            <span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: 24 }}>
              {form.maxConcurrent || 3}
            </span>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <label>Speed limit (KB/s)</label>
            <div className="hint">Global cap across all downloads. 0 = unlimited</div>
          </div>
          <input
            className="settings-input"
            type="number"
            min={0}
            value={form.speedLimit || 0}
            onChange={e => set('speedLimit', e.target.value)}
            style={{ width: 100 }}
          />
        </div>
      </div>

      {/* ── Browser Extension Intercept ────────────────────────── */}
      <div className="settings-section">
        <h3>Browser Intercept</h3>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          These settings control when the browser extension shows a download prompt.
          Changes apply to the extension within 30 seconds.
        </p>

        <div className="settings-row">
          <div>
            <label>Minimum file size</label>
            <div className="hint">Ignore files smaller than this (avoids tiny media)</div>
          </div>
          <select
            className="settings-input"
            style={{ width: 200 }}
            value={form.minInterceptSize || '1048576'}
            onChange={e => set('minInterceptSize', e.target.value)}
          >
            {MIN_SIZE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="settings-row" style={{ alignItems: 'flex-start', paddingTop: 14 }}>
          <div>
            <label>File types to intercept</label>
            <div className="hint">Comma-separated extensions (link button + intercept bar)</div>
          </div>
          <textarea
            className="settings-input"
            style={{ width: 260, height: 72, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
            value={form.interceptTypes || ''}
            onChange={e => set('interceptTypes', e.target.value)}
            placeholder="mp4,mkv,zip,pdf,mp3..."
          />
        </div>
      </div>

      {/* ── About ─────────────────────────────────────────────── */}
      <div className="settings-section">
        <h3>About</h3>
        <div className="settings-row">
          <label>Version</label>
          <span style={{ color: 'var(--muted)' }}>1.0.0</span>
        </div>
        <div className="settings-row">
          <label>Data directory</label>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>~/.ldm/ldm.db</span>
        </div>
      </div>

      <button className="btn-save" onClick={handleSave}>
        {saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  )
}
