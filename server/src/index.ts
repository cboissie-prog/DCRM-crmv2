import 'dotenv/config'
import logger from './lib/logger'

// Validation des variables d'environnement critiques au démarrage
const REQUIRED_ENV = ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal(`FATAL: Variable d'environnement manquante : ${key}`)
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
