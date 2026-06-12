import cron, { ScheduledTask } from 'node-cron'
import fs from 'fs'
import prisma from './prisma/client'
import logger from './lib/logger'
import { runOverdueTickets, runOpportunityInactive, runContractExpiring } from './automation-engine'
import { runCalendarSync, renewExpiringChannels } from './services/google-calendar'

// ─── Helper : lire un setting entier depuis la DB ─────────────────────────────

async function getSettingInt(key: string, fallback: number): Promise<number> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } })
    const n = parseInt(row?.value ?? '', 10)
    return isNaN(n) ? fallback : n
  } catch { return fallback }
}

async function getSettingStr(key: string, fallback: string): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } })
    return row?.value ?? fallback
  } catch { return fallback }
}

// ─── Job : mise à jour des statuts contrats ───────────────────────────────────

export async function runContractStatusUpdate(): Promise<{ expired: number; expiringSoon: number; reactivated: number }> {
  const days = await getSettingInt('contractExpiringSoonDays', 60)
  const now = new Date()
  const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  // 1. ACTIVE | EXPIRING_SOON → EXPIRED si date dépassée
  const { count: expired } = await prisma.contract.updateMany({
    where: { status: { in: ['ACTIVE', 'EXPIRING_SOON', 'PENDING'] }, endDate: { lt: now } },
    data: { status: 'EXPIRED' },
  })

  // 2. ACTIVE → EXPIRING_SOON si date dans le seuil
  const { count: expiringSoon } = await prisma.contract.updateMany({
    where: { status: 'ACTIVE', endDate: { gte: now, lt: threshold } },
    data: { status: 'EXPIRING_SOON' },
  })

  // 3. EXPIRING_SOON → ACTIVE si date prolongée au-delà du seuil (renouvellement manuel)
  const { count: reactivated } = await prisma.contract.updateMany({
    where: { status: 'EXPIRING_SOON', endDate: { gte: threshold } },
    data: { status: 'ACTIVE' },
  })

  return { expired, expiringSoon, reactivated }
}

// ─── Job : rappels agenda (toutes les 15 min) ─────────────────────────────────

export async function runAppointmentReminders(): Promise<number> {
  const now = new Date()
  const windowStart = new Date(now.getTime() + 27 * 60 * 1000)  // dans 27 min
  const windowEnd   = new Date(now.getTime() + 33 * 60 * 1000)  // dans 33 min

  // RDV commençant dans ~30 min
  const upcoming = await prisma.appointment.findMany({
    where: { startAt: { gte: windowStart, lte: windowEnd } },
    include: { users: { select: { userId: true } } },
  })

  let sent = 0
  for (const appt of upcoming) {
    const startDate = appt.startAt
    const timeStr = startDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

    for (const { userId } of appt.users) {
      // Éviter les doublons
      const exists = await prisma.notification.findFirst({
        where: { appointmentId: appt.id, userId, type: 'APPOINTMENT_REMINDER' },
      })
      if (exists) continue

      await prisma.notification.create({
        data: {
          userId,
          type: 'APPOINTMENT_REMINDER',
          title: 'Rappel rendez-vous',
          message: `${appt.title} commence à ${timeStr} (dans 30 min)`,
          link: '/appointments',
          appointmentId: appt.id,
        },
      })
      sent++
    }
  }
  return sent
}

// ─── Planificateur ────────────────────────────────────────────────────────────

let currentTask: ScheduledTask | null = null
let reminderTask: ScheduledTask | null = null
let automationTask: ScheduledTask | null = null
let calendarSyncTask: ScheduledTask | null = null

function parseCronTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const hh = isNaN(h) ? 2 : h
  const mm = isNaN(m) ? 0 : m
  return `${mm} ${hh} * * *`
}

export async function startScheduler() {
  const enabled = await getSettingStr('schedulerEnabled', 'true')
  const time = await getSettingStr('schedulerTime', '02:00')

  if (currentTask) { currentTask.stop(); currentTask = null }
  if (reminderTask) { reminderTask.stop(); reminderTask = null }
  if (automationTask) { automationTask.stop(); automationTask = null }
  if (calendarSyncTask) { calendarSyncTask.stop(); calendarSyncTask = null }

  if (enabled !== 'true') {
    logger.info('  ⏸  Scheduler désactivé (paramètre schedulerEnabled=false)')
    return
  }

  const cronExpr = parseCronTime(time)
  logger.info(`  ⏰ Scheduler contrats planifié à ${time} (cron: ${cronExpr})`)

  currentTask = cron.schedule(cronExpr, async () => {
    logger.info('🔄 Mise à jour des statuts contrats...')
    try {
      const result = await runContractStatusUpdate()
      logger.info(`  ✅ Contrats : ${result.expired} expirés, ${result.expiringSoon} expirant bientôt, ${result.reactivated} réactivés`)
    } catch (err) {
      logger.error({ err }, '  ❌ Erreur scheduler contrats')
    }

    // Purge des tokens de sécurité expirés
    try {
      const now = new Date()
      const { count: expiredRefresh } = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } })
      const { count: expiredReset } = await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } })
      logger.info(`  🧹 Purge tokens : ${expiredRefresh} refresh token(s) expiré(s), ${expiredReset} reset token(s) expiré(s) supprimé(s)`)
    } catch (err) {
      logger.error({ err }, '  ❌ Erreur scheduler purge tokens')
    }

    // Purge RGPD des enregistrements d'appels
    try {
      const retentionDays = await getSettingInt('callRecordingRetentionDays', 180)
      if (retentionDays > 0) {
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
        let totalPurged = 0
        // Traitement par lots pour ne pas charger toute la table
        let hasMore = true
        while (hasMore) {
          const calls = await prisma.call.findMany({
            where: {
              startedAt: { lt: cutoff },
              OR: [
                { recordingPath: { not: null } },
                { recordingUrl:  { not: null } },
              ],
            },
            select: { id: true, recordingPath: true },
            take: 200,
          })
          if (calls.length === 0) { hasMore = false; break }

          for (const call of calls) {
            if (call.recordingPath) {
              try { fs.unlinkSync(call.recordingPath) } catch { /* fichier déjà absent */ }
            }
          }
          const ids = calls.map(c => c.id)
          await prisma.call.updateMany({
            where: { id: { in: ids } },
            data: { recordingPath: null, recordingUrl: null },
          })
          totalPurged += calls.length
          if (calls.length < 200) hasMore = false
        }
        if (totalPurged > 0) {
          logger.info(`  🗑️  Purge RGPD enregistrements : ${totalPurged} appel(s) purgé(s) (rétention ${retentionDays}j)`)
        }
      } else {
        logger.info('  ℹ️  Purge RGPD enregistrements désactivée (callRecordingRetentionDays=0)')
      }
    } catch (err) {
      logger.error({ err }, '  ❌ Erreur scheduler purge RGPD enregistrements')
    }
  }, { timezone: 'Europe/Paris' })

  // Rappels agenda toutes les 5 minutes
  reminderTask = cron.schedule('*/5 * * * *', async () => {
    try {
      const sent = await runAppointmentReminders()
      if (sent > 0) logger.info(`🔔 Rappels agenda : ${sent} notification(s) envoyée(s)`)
    } catch (err) {
      logger.error({ err }, '  ❌ Erreur scheduler rappels agenda')
    }
  }, { timezone: 'Europe/Paris' })

  // Synchro Google Calendar toutes les 5 minutes
  calendarSyncTask = cron.schedule('*/5 * * * *', async () => {
    try {
      const stats = await runCalendarSync()
      if (stats.pulled > 0 || stats.pushed > 0 || stats.errors > 0) {
        logger.info(`📅 Google Calendar sync : ${stats.pulled} importés, ${stats.pushed} poussés, ${stats.errors} erreur(s)`)
      }
    } catch (err) {
      logger.error({ err }, '  ❌ Erreur scheduler Google Calendar sync')
    }
  }, { timezone: 'Europe/Paris' })

  // Automatisations planifiées toutes les heures + renouvellement des canaux watch Google
  automationTask = cron.schedule('0 * * * *', async () => {
    try {
      const [overdue, inactive, expiring] = await Promise.all([
        runOverdueTickets(),
        runOpportunityInactive(),
        runContractExpiring(),
      ])
      const total = overdue + inactive + expiring
      if (total > 0) logger.info(`⚡ Automatisations : ${overdue} tickets en retard, ${inactive} opps inactives, ${expiring} contrats expirants`)
    } catch (err) {
      logger.error({ err }, '  ❌ Erreur scheduler automatisations')
    }

    // Renouvellement des canaux watch Google Calendar expirant dans < 24 h
    try {
      const renewed = await renewExpiringChannels()
      if (renewed > 0) logger.info(`📡 Google Calendar watch : ${renewed} canal(aux) renouvelé(s)`)
    } catch (err) {
      logger.error({ err }, '  ❌ Erreur scheduler renouvellement canaux Google Calendar')
    }
  }, { timezone: 'Europe/Paris' })
}

// Permet de relancer le scheduler après un changement de config
export async function restartScheduler() {
  logger.info('  🔁 Rechargement du scheduler...')
  await startScheduler()
}
