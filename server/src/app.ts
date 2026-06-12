import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import path from 'path'

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
import googleRoutes from './routes/google'
import calendarAccessRoutes from './routes/calendar-access'
import prisma from './prisma/client'
import { authenticate, requirePermission } from './middleware/auth'
import { errorHandler, notFound } from './middleware/errorHandler'

export interface CreateAppOptions {
  /** Si false, les rate limiters ne sont pas montés (pratique pour les tests) */
  rateLimit?: boolean
}

export function createApp(opts: CreateAppOptions = {}): express.Express {
  const enableRateLimit = opts.rateLimit !== false

  const app = express()
  app.set('trust proxy', 1)

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
  app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined', {
    // Silence morgan in test to avoid noise
    skip: () => process.env.NODE_ENV === 'test',
  }))

  if (enableRateLimit) {
    const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: 'Trop de requêtes, réessayez plus tard.' })
    app.use('/api', limiter)

    const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Trop de tentatives, réessayez dans 15 minutes.' })
    app.use('/api/auth/login', authLimiter)
    app.use('/api/auth/forgot-password', authLimiter)
    app.use('/api/auth/google', authLimiter)

    const webhookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, message: 'Trop de requêtes webhook, réessayez plus tard.' })
    app.use('/api/calls/webhook', webhookLimiter)

    // Limiter dédié pour les notifications push Google Calendar (généreux — Google peut envoyer ~1/s)
    const googleNotifLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, message: 'Trop de notifications Google, réessayez plus tard.' })
    app.use('/api/google/notifications', googleNotifLimiter)
  }

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
  app.use('/api/google', googleRoutes)
  app.use('/api/calendar-access', calendarAccessRoutes)

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

  return app
}
