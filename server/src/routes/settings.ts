import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requireRole } from '../middleware/auth'
import { restartScheduler } from '../scheduler'

const router = Router()
router.use(authenticate)

// Default settings values
const DEFAULTS: Record<string, { value: string; label: string }> = {
  contractExpiringSoonDays: { value: '60',      label: 'Alerte contrats expirant dans (jours)' },
  licenseExpiringSoonDays:  { value: '30',      label: 'Alerte licences expirant dans (jours)' },
  schedulerEnabled:         { value: 'true',    label: 'Mise à jour automatique des statuts activée' },
  schedulerTime:            { value: '02:00',   label: 'Heure d\'exécution du job (HH:MM, heure serveur)' },
  companyName:              { value: 'MonCRM',  label: 'Nom de l\'entreprise' },
  companyLogoUrl:           { value: '',        label: 'URL du logo' },
  companyAddress:           { value: '',        label: 'Adresse' },
  companyContactEmail:      { value: '',        label: 'Email de contact' },
  companyPhone:             { value: '',        label: 'Téléphone' },
  companySiret:             { value: '',        label: 'SIRET' },
  companyVatNumber:         { value: '',        label: 'N° TVA' },
}

// GET /api/settings — all settings (admin only)
router.get('/', requireRole(['ADMIN']), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rows = await prisma.setting.findMany()
    // Merge DB values with defaults so all keys are always present
    const result = Object.entries(DEFAULTS).map(([key, def]) => {
      const row = rows.find(r => r.key === key)
      return { key, value: row?.value ?? def.value, label: def.label }
    })
    res.json({ success: true, data: result })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

// GET /api/settings/:key — single setting (internal use, no role restriction)
router.get('/:key', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { key } = req.params
    const row = await prisma.setting.findUnique({ where: { key } })
    const def = DEFAULTS[key]
    const value = row?.value ?? def?.value ?? null
    if (value === null) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Paramètre introuvable' } }); return }
    res.json({ success: true, data: { key, value, label: def?.label } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

// PUT /api/settings/:key — update setting (admin only)
router.put('/:key', requireRole(['ADMIN']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { key } = req.params
    const { value } = z.object({ value: z.string() }).parse(req.body)
    if (!DEFAULTS[key]) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Paramètre inconnu' } }); return }
    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value, label: DEFAULTS[key].label },
      create: { key, value, label: DEFAULTS[key].label },
    })
    // Relancer le scheduler si un paramètre lié est modifié
    if (['schedulerEnabled', 'schedulerTime'].includes(key)) {
      restartScheduler().catch(console.error)
    }
    res.json({ success: true, data: setting })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// POST /api/settings/actions/run-contract-update — déclencher manuellement le job
router.post('/actions/run-contract-update', requireRole(['ADMIN']), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { runContractStatusUpdate } = await import('../scheduler')
    const result = await runContractStatusUpdate()
    res.json({ success: true, data: result })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
export { DEFAULTS as SETTING_DEFAULTS }
