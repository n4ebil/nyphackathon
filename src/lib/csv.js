/**
 * Minimal CSV/TSV parser for the student directory import — deliberately
 * dependency-free rather than pulling in a spreadsheet library (the popular
 * one, xlsx/SheetJS, ships known unpatched vulnerabilities on npm). Excel
 * and Google Sheets both export CSV directly, so this covers the real need
 * without the extra attack surface.
 */

const HEADER_ALIASES = {
  adminNo: ['adminno', 'admin no', 'admin number', 'admin no.', 'student id', 'studentid'],
  name: ['name', 'full name', 'student name'],
  course: ['course', 'diploma', 'course name', 'programme', 'program'],
  year: ['year', 'year of study'],
}

function splitLine(line, delimiter) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells.map((c) => c.trim())
}

function matchHeader(header) {
  const lower = header.trim().toLowerCase()
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(lower)) return field
  }
  return null
}

/**
 * Parses CSV or TSV text into { adminNo, name, course, year } rows.
 * Returns { rows, skipped } — skipped counts lines missing a required field.
 */
export function parseStudentDirectory(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (!lines.length) return { rows: [], skipped: 0 }

  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const headerCells = splitLine(lines[0], delimiter)
  const fieldByColumn = headerCells.map(matchHeader)

  if (!fieldByColumn.includes('adminNo') || !fieldByColumn.includes('name')) {
    throw new Error('Could not find "Admin No" and "Name" columns — check the header row.')
  }

  const rows = []
  let skipped = 0
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delimiter)
    const row = {}
    fieldByColumn.forEach((field, i) => {
      if (field) row[field] = cells[i] || ''
    })
    row.adminNo = (row.adminNo || '').toUpperCase()
    if (!row.adminNo || !row.name) {
      skipped++
      continue
    }
    if (row.year) row.year = Number(row.year) || undefined
    rows.push(row)
  }
  return { rows, skipped }
}
