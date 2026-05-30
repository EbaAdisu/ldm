import DownloadItem from './DownloadItem.jsx'

export default function DownloadList({ downloads, onAction }) {
  if (!downloads.length) {
    return (
      <div className="empty-state">
        <div className="big-icon">⬇</div>
        <p>No downloads yet</p>
        <p style={{ fontSize: 12 }}>Click "New Download" or use the browser extension</p>
      </div>
    )
  }

  return (
    <div>
      {downloads.map(d => (
        <DownloadItem key={d.id} download={d} onAction={onAction} />
      ))}
    </div>
  )
}
