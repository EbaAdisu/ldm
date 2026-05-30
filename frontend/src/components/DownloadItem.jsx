function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0, n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${units[i]}`
}

function formatSpeed(bps) {
  if (!bps || bps === 0) return ''
  return formatBytes(bps) + '/s'
}

function getPercent(dl) {
  if (dl.status === 'completed') return 100
  if (dl.percent) return dl.percent
  if (dl.size > 0) return Math.min(100, Math.round((dl.downloaded / dl.size) * 100))
  return 0
}

export default function DownloadItem({ download: dl, onAction }) {
  const pct = getPercent(dl)
  const isActive = ['downloading', 'pending'].includes(dl.status)

  const title    = dl.title || dl.filename || dl.url?.split('/').pop()?.split('?')[0] || dl.url
  const sizeText = dl.sizeStr || (dl.size > 0 ? `${formatBytes(dl.downloaded)} / ${formatBytes(dl.size)}` : '')
  const speedText = dl.speedStr || formatSpeed(dl.speed)

  return (
    <div className="dl-item">
      <div className="dl-header">
        {dl.thumbnail
          ? <img className="dl-thumb" src={dl.thumbnail} alt="" />
          : <div className="dl-thumb-placeholder">
              {dl.engine === 'ytdlp' ? '▶' : '📄'}
            </div>
        }

        <div className="dl-info">
          <div className="dl-title" title={title}>{title}</div>
          <div className="dl-url" title={dl.url}>{dl.url}</div>

          <div className="dl-meta">
            <span className={`dl-status ${dl.status}`}>{dl.status}</span>
            {sizeText  && <span className="dl-size">{sizeText}</span>}
            {speedText && isActive && <span className="dl-speed">{speedText}</span>}
            {pct > 0 && pct < 100 && <span className="dl-size">{pct}%</span>}
            <span className="dl-engine">{dl.engine}</span>
          </div>
        </div>

        <div className="dl-actions">
          {dl.status === 'downloading' && (
            <button className="btn-icon" title="Pause" onClick={() => onAction(dl.id, 'pause')}>⏸</button>
          )}
          {dl.status === 'paused' && (
            <button className="btn-icon" title="Resume" onClick={() => onAction(dl.id, 'resume')}>▶</button>
          )}
          {dl.status === 'error' && (
            <button className="btn-icon" title="Retry" onClick={() => onAction(dl.id, 'resume')}>↺</button>
          )}
          <button
            className="btn-icon danger"
            title="Delete"
            onClick={() => onAction(dl.id, 'delete')}
          >✕</button>
        </div>
      </div>

      {(isActive || dl.status === 'paused') && (
        <div className="progress-bar">
          <div
            className={`progress-fill ${dl.status === 'completed' ? 'complete' : dl.status === 'error' ? 'error' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {dl.status === 'completed' && (
        <div className="progress-bar">
          <div className="progress-fill complete" style={{ width: '100%' }} />
        </div>
      )}

      {dl.error && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--error)' }}>
          {dl.error}
        </div>
      )}
    </div>
  )
}
