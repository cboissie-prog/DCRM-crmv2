/**
 * Parse a CSV string into an array of objects.
 * Handles quoted fields, BOM prefix, and semicolon/comma delimiters.
 */
export function parseCsv(text: string): Record<string, string>[] {
  // Strip BOM
  const clean = text.replace(/^\uFEFF/, '').trim()
  if (!clean) return []

  const lines = clean.split(/\r?\n/)
  if (lines.length < 2) return []

  // Auto-detect delimiter: semicolon or comma
  const firstLine = lines[0]
  const sep = firstLine.includes(';') ? ';' : ','

  const headers = splitLine(firstLine, sep).map(h => h.trim())

  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cells = splitLine(line, sep)
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = cells[idx]?.trim() ?? ''
    })
    rows.push(row)
  }
  return rows
}

function splitLine(line: string, sep: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = false
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') {
        inQuote = true
      } else if (ch === sep) {
        cells.push(cur); cur = ''
      } else {
        cur += ch
      }
    }
  }
  cells.push(cur)
  return cells
}
