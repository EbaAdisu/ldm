import { useState, useEffect } from 'react'

export default function ExtensionPage() {
  const [extPath, setExtPath] = useState('')

  useEffect(() => {
    fetch('/api/extension-info')
      .then(r => r.json())
      .then(d => setExtPath(d.path))
      .catch(() => {})
  }, [])

  return (
    <div className="ext-page">
      <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
        The LDM browser extension detects videos and download links on any page
        and adds a download button directly on videos — just like IDM.
      </p>

      <div className="ext-steps">
        {/* Chrome */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span className="ext-badge chrome">Chrome / Brave / Edge</span>
          </div>

          <div className="ext-step">
            <div className="ext-step-num" />
            <div className="ext-step-body">
              <h4>Open Extensions page</h4>
              <p>Navigate to <code style={{ color: 'var(--accent)' }}>chrome://extensions</code> in your browser</p>
            </div>
          </div>

          <div className="ext-step">
            <div className="ext-step-num" />
            <div className="ext-step-body">
              <h4>Enable Developer Mode</h4>
              <p>Toggle "Developer mode" in the top-right corner of the Extensions page</p>
            </div>
          </div>

          <div className="ext-step">
            <div className="ext-step-num" />
            <div className="ext-step-body">
              <h4>Load the extension</h4>
              <p>Click "Load unpacked" and select this folder:</p>
              <div className="code-box">{extPath || '~/.ldm/extension  (loading...)'}</div>
            </div>
          </div>

          <div className="ext-step">
            <div className="ext-step-num" />
            <div className="ext-step-body">
              <h4>Done!</h4>
              <p>Visit any page with a video. You'll see a blue "⬇ LDM" button appear on the video.</p>
            </div>
          </div>
        </div>

        {/* Firefox */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span className="ext-badge firefox">Firefox</span>
          </div>

          <div className="ext-step">
            <div className="ext-step-num" />
            <div className="ext-step-body">
              <h4>Open Add-ons Debugging</h4>
              <p>Navigate to <code style={{ color: 'var(--accent)' }}>about:debugging#/runtime/this-firefox</code></p>
            </div>
          </div>

          <div className="ext-step">
            <div className="ext-step-num" />
            <div className="ext-step-body">
              <h4>Load Temporary Add-on</h4>
              <p>Click "Load Temporary Add-on..." and select <strong>manifest.json</strong> from:</p>
              <div className="code-box">{extPath ? `${extPath}/manifest.json` : 'loading...'}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 8 }}>
        <strong style={{ fontSize: 13 }}>What the extension does:</strong>
        <ul style={{ marginTop: 8, paddingLeft: 20, color: 'var(--muted)', fontSize: 13, lineHeight: 2 }}>
          <li>Detects <code>&lt;video&gt;</code> elements on any webpage</li>
          <li>Intercepts media network requests (.mp4, .m3u8, .webm)</li>
          <li>Injects a download button directly on the video player</li>
          <li>Sends the download to LDM running on localhost:6543</li>
        </ul>
      </div>
    </div>
  )
}
