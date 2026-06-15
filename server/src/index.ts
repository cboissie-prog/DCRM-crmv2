import 'dotenv/config'
import logger from './lib/logger'

// ─── Validation des variables d'environnement critiques au démarrage ──────────
const REQUIRED_ENV = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'TOKEN_ENC_KEY'] as const
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal(`FATAL: Variable d'environnement manquante : ${key}`)
    process.exit(1)
  }
}

// TOKEN_ENC_KEY doit être 64 caractères hexadécimaux (32 octets) — même contrainte que lib/crypto.ts.
// Validée au boot (et non plus à la première opération de chiffrement) pour un échec immédiat et lisible.
if (!/^[0-9a-fA-F]{64}$/.test(process.env.TOKEN_ENC_KEY!)) {
  logger.fatal('FATAL: TOKEN_ENC_KEY invalide — doit faire 64 caractères hexadécimaux (générer : openssl rand -hex 32)')
  process.exit(1)
}

// En production, refuser les secrets faibles ou laissés à leur valeur de développement.
// Un JWT_SECRET par défaut connu = forge de tokens ADMIN = compromission totale du CRM.
if (process.env.NODE_ENV === 'production') {
  // Marqueurs présents dans les valeurs de dev / les exemples (.env.production.example)
  const WEAK_MARKERS = ['dev-', 'change-in-prod', 'changeme', 'example', 'placeholder']
  const isWeak = (val: string): boolean => {
    const lower = val.toLowerCase()
    return val.length < 32 || WEAK_MARKERS.some(m => lower.includes(m))
  }

  // JWT_SECRET / JWT_REFRESH_SECRET sont requis ; VOIP_WEBHOOK_SECRET est optionnel (webhook désactivé si absent)
  const SECRETS_TO_CHECK = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'VOIP_WEBHOOK_SECRET'] as const
  for (const key of SECRETS_TO_CHECK) {
    const val = process.env[key]
    if (!val) continue
    if (isWeak(val)) {
      logger.fatal(`FATAL: ${key} trop faible ou laissé à sa valeur de dev en production — générer : openssl rand -hex 48`)
      process.exit(1)
    }
  }

  // Les deux secrets JWT doivent être distincts (sinon un access token peut servir de refresh token)
  if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    logger.fatal('FATAL: JWT_SECRET et JWT_REFRESH_SECRET doivent être différents')
    process.exit(1)
  }
}

import { createApp } from './app'
import { startScheduler } from './scheduler'

const app = createApp()
const PORT = Number(process.env.PORT) || 3001

const server = app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`🚀 CRM Server running on http://localhost:${PORT}`)
  logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`)
  logger.info(`   Database: SQLite (dev.db)`)
  await startScheduler()
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.fatal(
      `Le port ${PORT} est déjà utilisé par un autre serveur (probablement un ancien npm run dev resté ouvert).\n` +
      `   → Identifier le process : Get-NetTCPConnection -LocalPort ${PORT} | Select OwningProcess\n` +
      `   → Le tuer : Stop-Process -Id <PID> -Force, puis relancer npm run dev`
    )
    process.exit(1)
  }
  throw err
})
