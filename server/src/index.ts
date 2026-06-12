import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import path from 'path'

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
import rolesRoutes from './routes/roles'
import apikeysRoutes from './routes/apikeys'
import callsRoutes from './routes/calls'
import prisma from './prisma/client'
import { authenticate, requirePermission } from './middleware/auth'
import { errorHandler, notFound } from './middleware/errorHandler'
import { startScheduler } from './scheduler'

const app = express()
app.set('trust proxy', 1)
const PORT = Number(process.env.PORT) || 3001

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://unpkg.com'],
      'connect-src': ["'self'"],
      'media-src': ["'self'", 'blob:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}))
app.use(cors({
  origin: (origin, callback) => {
    const allowed = process.env.NODE_ENV === 'production'
      ? [process.env.FRONTEND_URL || 'http://localhost:5173']
      : [
          process.env.FRONTEND_URL || 'http://localhost:5173',
          /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
          /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
        ]
    if (!origin) return callback(null, true) // requêtes sans origin (mobile, curl)
    const ok = allowed.some(p => typeof p === 'string' ? p === origin : p.test(origin))
    callback(ok ? null : new Error('CORS'), ok)
  },
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'))

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: 'Trop de requêtes, réessayez plus tard.' })
app.use('/api', limiter)

// Rate limit strict sur les routes auth sensibles (anti brute-force)
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Trop de tentatives, réessayez dans 15 minutes.' })
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/forgot-password', authLimiter)

// Rate limit sur le webhook VoIP (120 req/15min pour les systèmes VoIP)
const webhookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, message: 'Trop de requêtes webhook, réessayez plus tard.' })
app.use('/api/calls/webhook', webhookLimiter)

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
app.use('/api/roles', authenticate, rolesRoutes)
app.use('/api/apikeys', authenticate, apikeysRoutes)
app.use('/api/calls', callsRoutes)

// GET /api/permissions — liste toutes les permissions disponibles, groupées par catégorie
app.get('/api/permissions', authenticate, requirePermission('settings:roles'), async (_req, res) => {
  try {
    const permissions = await prisma.permission.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] })
    const grouped = permissions.reduce<Record<string, typeof permissions>>((acc, perm) => {
      if (!acc[perm.category]) acc[perm.category] = []
      acc[perm.category].push(perm)
      return acc
    }, {})
    res.json({ success: true, data: grouped })
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// En production : Express sert le build React (dossier client/dist)
// __dirname = server/dist/ → ../../client/dist = httpdocs/app/client/dist
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  // SPA fallback — toutes les routes non-API renvoient index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.use(notFound)
app.use(errorHandler)

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 CRM Server running on http://localhost:${PORT}`)
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`   Database: SQLite (dev.db)`)
  await startScheduler()
  console.log()
})
