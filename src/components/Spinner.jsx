export function Spinner() {
  return <span className="spinner" />
}

export function Banner({ kind = 'info', children }) {
  return <div className={'banner ' + kind}>{children}</div>
}
