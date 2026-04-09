import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'

// Validation des variables d'environnement critiques au démarrage
const REQUIRED_ENV = ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Variable d'environnement manquante : ${key}`)
    process.exit(1)
  }
}

import authRoutes from './routes/auth'
import usersRoutes from './routes/users'
import contactsRoutes from './routes/contacts'
import companiesRoutes from './routes/companies'
import pipelineRoutes from './routes/pipeline'
import productsRoutes from './routes/products'
import ticketsRoutes from './routes/tickets'
import contractsRoutes from './routes/contracts'
import equipmentRoutes from './routes/equipment'
import licensesRoutes from './routes/licenses'
import activitiesRoutes from './routes/activities'
import appointmentsRoutes from './routes/appointments'
import dashboardRoutes from './routes/dashboard'
import notificationsRoutes from './routes/notifications'
import knowledgeRoutes from './routes/knowledge'
import automationsRoutes from './routes/automations'
import targetsRoutes from './routes/targets'
import parcRoutes from './routes/parc'
import pipelinesRoutes from './routes/pipelines'
import settingsRoutes from './routes/settings'
import reportsRoutes from './routes/reports'
import searchRoutes from './routes/search'
import { errorHandler, notFound } from './middleware/errorHandler'
import { startScheduler } from './scheduler'

const app = express()
const PORT = process.env.PORT || 3001

app.use(helmet())
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'))

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: 'Trop de requêtes, réessayez plus tard.' })
app.use('/api', limiter)

// Rate limit strict sur les routes auth sensibles (anti brute-force)
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Trop de tentatives, réessayez dans 15 minutes.' })
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/forgot-password', authLimiter)

app.use('/api/auth', authRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/contacts', contactsRoutes)
app.use('/api/companies', companiesRoutes)
app.use('/api/pipeline', pipelineRoutes)
app.use('/api/products', productsRoutes)
app.use('/api/tickets', ticketsRoutes)
app.use('/api/contracts', contractsRoutes)
app.use('/api/equipment', equipmentRoutes)
app.use('/api/licenses', licensesRoutes)
app.use('/api/activities', activitiesRoutes)
app.use('/api/appointments', appointmentsRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/notifications', notificationsRoutes)
app.use('/api/knowledge', knowledgeRoutes)
app.use('/api/automations', automationsRoutes)
app.use('/api/targets', targetsRoutes)
app.use('/api/parc', parcRoutes)
app.use('/api/pipelines', pipelinesRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/search', searchRoutes)

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.use(notFound)
app.use(errorHandler)

app.listen(PORT, async () => {
  console.log(`\n🚀 CRM Server running on http://localhost:${PORT}`)
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`   Database: SQLite (dev.db)`)
  await startScheduler()
  console.log()
})
