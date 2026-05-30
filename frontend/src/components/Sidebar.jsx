export default function Sidebar({ page, onPage, counts }) {
  const nav = [
    { id: 'downloads', icon: '⬇', label: 'Downloads', badge: counts.active || null },
    { id: 'history',   icon: '✓', label: 'History',   badge: counts.completed || null },
    { id: 'extension', icon: '🧩', label: 'Extension' },
    { id: 'settings',  icon: '⚙', label: 'Settings'  },
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span>⬇</span> LDM
      </div>

      <div className="nav-section">Navigation</div>

      {nav.map(item => (
        <button
          key={item.id}
          className={`nav-item ${page === item.id ? 'active' : ''}`}
          onClick={() => onPage(item.id)}
        >
          <span className="icon">{item.icon}</span>
          {item.label}
          {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
        </button>
      ))}
    </aside>
  )
}
