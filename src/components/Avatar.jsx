const COLORS = ['#f3bba8', '#bfcef7', '#c9e2c6', '#f4c6b6', '#d9c8f5', '#c6e6f0']

export function initialsOf(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function colorFor(id = '') {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return COLORS[hash % COLORS.length]
}

export function Avatar({ name, id, small = false }) {
  return (
    <div className={'avatar ' + (small ? 'small' : '')} style={{ background: colorFor(id || name) }}>
      {initialsOf(name)}
    </div>
  )
}
