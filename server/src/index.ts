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

app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`🚀 CRM Server running on http://localhost:${PORT}`)
  logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`)
  logger.info(`   Database: SQLite (dev.db)`)
  await startScheduler()
})
