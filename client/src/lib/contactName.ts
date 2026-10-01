/** « Jean Dupont » → { firstName: 'Jean', lastName: 'Dupont' } ; un seul mot → prénom seul. */
export function splitFullName(full?: string | null): { firstName: string; lastName: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/** 0033601020304 / +33601020304 → 0601020304 (format national lisible). */
export function toNationalPhone(num?: string | null): string {
  if (!num) return ''
  const cleaned = num.replace(/[^\d+]/g, '')
  if (cleaned.startsWith('0033')) return '0' + cleaned.slice(4)
  if (cleaned.startsWith('+33')) return '0' + cleaned.slice(3)
  return num
}
