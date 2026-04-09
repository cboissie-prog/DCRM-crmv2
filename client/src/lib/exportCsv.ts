import api from './api'

/**
 * Télécharge un CSV depuis un endpoint backend.
 * @param url     Chemin API (ex: '/contacts/export/csv')
 * @param params  Query params optionnels (filtres actifs)
 * @param filename Nom du fichier suggéré (fallback si le header Content-Disposition est absent)
 */
export async function downloadCsv(url: string, params?: Record<string, string | undefined>, filename?: string): Promise<void> {
  const response = await api.get(url, {
    params,
    responseType: 'blob',
  })
  const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename ?? 'export.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}
