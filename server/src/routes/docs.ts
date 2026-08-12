import { Router, Response } from 'express'
import path from 'path'
import fs from 'fs'
import { AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'

const router = Router()

// server/docs/ est versionné (contrairement aux docs internes de la racine, gitignorées)
// → présent en prod via le déploiement Git. src/routes et dist/routes sont à la même profondeur.
const DOCS_DIR = path.join(__dirname, '../../docs')

function readDoc(filename: string): string | null {
  const filePath = path.join(DOCS_DIR, filename)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

// GET /api/docs/markdown — documentation API au format Markdown (API.md)
router.get('/markdown', requirePermission('apidocs:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const content = readDoc('API.md')
    if (content === null) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Fichier API.md introuvable sur le serveur' } })
      return
    }
    res.type('text/markdown; charset=utf-8').send(content)
  } catch (err) { handleRouteError(err, res) }
})

// GET /api/docs/openapi — documentation API au format OpenAPI 3 (openapi.json)
router.get('/openapi', requirePermission('apidocs:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const content = readDoc('openapi.json')
    if (content === null) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Fichier openapi.json introuvable sur le serveur' } })
      return
    }
    res.type('application/json; charset=utf-8').send(content)
  } catch (err) { handleRouteError(err, res) }
})

export default router
