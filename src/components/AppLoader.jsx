export function AppLoader({ compact = false }) {
  return (
    <div className={'app-loader' + (compact ? ' compact' : '')}>
      <div className="app-loader-inner">
        <div className="app-loader-orbit">
          <img className="app-loader-mark" src="/icon1.svg" alt="" />
          <div className="orbit-ring">
            <span className="orbit-dot dot-1" />
            <span className="orbit-dot dot-2" />
            <span className="orbit-dot dot-3" />
          </div>
        </div>
        {!compact && <p className="app-loader-text">Getting things ready…</p>}
      </div>
    </div>
  )
}
