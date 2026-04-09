import cron from 'node-cron'
import prisma from './prisma/client'
import { runOverdueTickets, runOpportunityInactive, runContractExpiring } from './automation-engine'

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

let currentTask: cron.ScheduledTask | null = null
let reminderTask: cron.ScheduledTask | null = null

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

  if (enabled !== 'true') {
    console.log('  ⏸  Scheduler désactivé (paramètre schedulerEnabled=false)')
    return
  }

  const cronExpr = parseCronTime(time)
  console.log(`  ⏰ Scheduler contrats planifié à ${time} (cron: ${cronExpr})`)

  currentTask = cron.schedule(cronExpr, async () => {
    console.log(`[${new Date().toISOString()}] 🔄 Mise à jour des statuts contrats...`)
    try {
      const result = await runContractStatusUpdate()
      console.log(`  ✅ Contrats : ${result.expired} expirés, ${result.expiringSoon} expirant bientôt, ${result.reactivated} réactivés`)
    } catch (err) {
      console.error('  ❌ Erreur scheduler contrats:', err)
    }
  }, { timezone: 'Europe/Paris' })

  // Rappels agenda toutes les 5 minutes
  reminderTask = cron.schedule('*/5 * * * *', async () => {
    try {
      const sent = await runAppointmentReminders()
      if (sent > 0) console.log(`[${new Date().toISOString()}] 🔔 Rappels agenda : ${sent} notification(s) envoyée(s)`)
    } catch (err) {
      console.error('  ❌ Erreur scheduler rappels agenda:', err)
    }
  }, { timezone: 'Europe/Paris' })

  // Automatisations planifiées toutes les heures
  cron.schedule('0 * * * *', async () => {
    try {
      const [overdue, inactive, expiring] = await Promise.all([
        runOverdueTickets(),
        runOpportunityInactive(),
        runContractExpiring(),
      ])
      const total = overdue + inactive + expiring
      if (total > 0) console.log(`[${new Date().toISOString()}] ⚡ Automatisations : ${overdue} tickets en retard, ${inactive} opps inactives, ${expiring} contrats expirants`)
    } catch (err) {
      console.error('  ❌ Erreur scheduler automatisations:', err)
    }
  }, { timezone: 'Europe/Paris' })
}

// Permet de relancer le scheduler après un changement de config
export async function restartScheduler() {
  console.log('  🔁 Rechargement du scheduler...')
  await startScheduler()
}
