/**
 * Échappe les valeurs CSV pour éviter l'injection de formules Excel/LibreOffice.
 * Neutralise les formules démarrées par =, +, -, @, tab ou CR en début de cellule.
 */
export function csvEscape(v: unknown): string {
  let s = v == null ? '' : String(v)
  // Neutralise les formules Excel/LibreOffice (=, +, -, @, tab, CR en début de cellule)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}
