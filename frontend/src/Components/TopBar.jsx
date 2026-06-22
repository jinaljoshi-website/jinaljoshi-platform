export default function TopBar({ onFanConnect }) {
  return (
    <header className="topbar">
      <div className="topbar__brand">Jinal Joshi</div>

      <button className="topbar__link" onClick={onFanConnect} type="button">
        Fan Connect
      </button>
    </header>
  )
}