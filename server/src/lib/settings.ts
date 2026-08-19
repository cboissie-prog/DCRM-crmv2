import prisma from '../prisma/client'

/**
 * Lecture d'un paramètre numérique (table Setting) avec repli sur la valeur par
 * défaut — mutualisé entre scheduler et routes (contrats, licences, parc,
 * équipements, dashboard) pour que les seuils soient pilotés par un seul réglage.
 */
export async function getSettingInt(key: string, fallback: number): Promise<number> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } })
    const n = parseInt(row?.value ?? '', 10)
    return !isNaN(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

export async function getSettingStr(key: string, fallback: string): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } })
    return row?.value ?? fallback
  } catch {
    return fallback
  }
}
