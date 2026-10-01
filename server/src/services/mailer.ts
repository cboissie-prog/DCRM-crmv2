import nodemailer from 'nodemailer'
import logger from '../lib/logger'

/** SMTP configuré dès qu'un hôte ou un utilisateur est fourni (sinon les envois sont ignorés silencieusement). */
export const isMailerConfigured = (): boolean => Boolean(process.env.SMTP_HOST || process.env.SMTP_USER)

const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587')
const SMTP_SECURE = process.env.SMTP_SECURE === 'true'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
  // Un port filtré ou un hôte muet ne doit pas bloquer indéfiniment (verify() est aussi appelé depuis l'UI)
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
})

const FROM = process.env.SMTP_FROM || 'DCB Technologies <noreply@dcb-technologies.fr>'
// Base des liens contenus dans les emails — même variable que les redirections OAuth (APP_URL conservé en repli)
const APP_URL = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173'

/** Envoi générique — retourne silencieusement si le mailer n'est pas configuré */
export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }): Promise<void> {
  if (!isMailerConfigured()) {
    logger.warn({ to: opts.to, subject: opts.subject }, '[MAILER] SMTP non configuré — email non envoyé')
    return
  }
  await transporter.sendMail({ from: FROM, ...opts })
}

export interface MailerStatus {
  configured: boolean
  host: string | null
  port: number
  /** 'SSL' (port 465, SMTP_SECURE=true) ou 'STARTTLS' (port 587, SMTP_SECURE absent/false) */
  mode: 'SSL' | 'STARTTLS'
  /** Identifiant SMTP masqué (ex. `c.***@dcb-technologies.fr`), null si envoi anonyme */
  user: string | null
  from: string
  frontendUrl: string
  /** Variables d'environnement SMTP_* / FRONTEND_URL manquantes ou vides */
  missing: string[]
  /** Résultat du test de connexion (transporter.verify) — absent si SMTP non configuré ou test non demandé */
  connection?: { ok: true; latencyMs: number } | { ok: false; code: string | null; message: string }
}

function maskUser(user: string | undefined): string | null {
  if (!user) return null
  const at = user.indexOf('@')
  const local = at > 0 ? user.slice(0, at) : user
  const domain = at > 0 ? user.slice(at) : ''
  return `${local.slice(0, 2)}***${domain}`
}

/** Résume une erreur nodemailer en une ligne (code + message), sans identifiants. */
export function describeMailError(err: unknown): { code: string | null; message: string } {
  const e = err as { code?: string; responseCode?: number; message?: string } | undefined
  const code = e?.code ?? (e?.responseCode ? String(e.responseCode) : null)
  const message = (e?.message ?? String(err)).split('\n')[0].slice(0, 300)
  return { code, message }
}

/** État de la configuration SMTP, avec un test de connexion réel si `probe` est vrai. */
export async function getMailerStatus(probe = true): Promise<MailerStatus> {
  const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'FRONTEND_URL']
    .filter(k => !process.env[k])
  const status: MailerStatus = {
    configured: isMailerConfigured(),
    host: process.env.SMTP_HOST || null,
    port: SMTP_PORT,
    mode: SMTP_SECURE ? 'SSL' : 'STARTTLS',
    user: maskUser(process.env.SMTP_USER),
    from: FROM,
    frontendUrl: APP_URL,
    missing,
  }
  if (status.configured && probe) {
    const started = Date.now()
    try {
      await transporter.verify()
      status.connection = { ok: true, latencyMs: Date.now() - started }
    } catch (err) {
      status.connection = { ok: false, ...describeMailError(err) }
    }
  }
  return status
}

/** Envoie un email de test (diagnostic admin). Laisse remonter l'erreur SMTP brute pour que la route la décrive. */
export async function sendTestEmail(to: string): Promise<{ messageId: string | null; accepted: string[]; rejected: string[] }> {
  const sentAt = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
  const server = `${process.env.SMTP_HOST ?? ''}:${SMTP_PORT} (${SMTP_SECURE ? 'SSL' : 'STARTTLS'})`
  const info = await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Test d\'envoi — DCB Technologies CRM',
    text: `Cet email confirme que l'envoi SMTP du CRM fonctionne.\n\nServeur : ${server}\nLiens générés vers : ${APP_URL}\nEnvoyé le ${sentAt}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 32px;">
        <h2 style="color: #1e293b; margin-bottom: 8px;">Envoi SMTP opérationnel</h2>
        <p style="color: #475569;">Cet email confirme que l'envoi SMTP du CRM DCB Technologies fonctionne.</p>
        <table style="font-size: 14px; color: #1e293b; border-collapse: collapse;">
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Serveur</td><td>${escapeHtml(server)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Liens générés vers</td><td>${escapeHtml(APP_URL)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #64748b;">Envoyé le</td><td>${escapeHtml(sentAt)}</td></tr>
        </table>
      </div>
    `,
  })
  return {
    messageId: info.messageId ?? null,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
  }
}

/** Vérifie la connexion SMTP au démarrage (STARTTLS/SSL, identifiants) et loggue le résultat sans bloquer le boot. */
export async function verifyMailer(): Promise<void> {
  if (!isMailerConfigured()) {
    logger.warn('[MAILER] SMTP non configuré (SMTP_HOST/SMTP_USER absents) — aucun email ne sera envoyé (réinitialisation de mot de passe, clôture de tickets)')
    return
  }
  try {
    await transporter.verify()
    logger.info(`[MAILER] SMTP prêt — ${process.env.SMTP_HOST}:${SMTP_PORT} (${SMTP_SECURE ? 'SSL' : 'STARTTLS'})`)
  } catch (err) {
    logger.error({ err }, '[MAILER] Connexion SMTP impossible — vérifier SMTP_HOST/PORT/SECURE/USER/PASS')
  }
}

/** Neutralise le HTML dans les valeurs interpolées (titres de tickets saisis par l'utilisateur). */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/** Email de clôture de ticket envoyé au demandeur/contact */
export async function sendTicketClosedEmail(params: {
  to: string
  reference: string
  title: string
  technicien?: string
  timeSpent: number
  status: string
  /** Jeton signé d'enquête NPS — si présent, l'email inclut le lien de notation */
  npsToken?: string
}): Promise<void> {
  const { to, reference, title, technicien, timeSpent, status, npsToken } = params
  const timeLabel = timeSpent < 60
    ? `${timeSpent} min`
    : `${Math.floor(timeSpent / 60)}h${timeSpent % 60 > 0 ? ` ${timeSpent % 60}min` : ''}`
  const statusLabel = status === 'CLOSED' ? 'Fermé' : status === 'RESOLVED' ? 'Résolu' : status
  const npsUrl = npsToken ? `${APP_URL}/nps/${npsToken}` : null

  await sendMail({
    to,
    subject: `[Clôture] #${reference} — ${title}`,
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: auto; padding: 32px; background: #f8fafc; border-radius: 12px;">
        <h2 style="color: #1e293b; margin-bottom: 4px;">Ticket clôturé</h2>
        <p style="color: #64748b; margin-bottom: 24px; font-size: 14px;">Votre demande de support a été traitée et clôturée.</p>
        <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 8px 0; color: #64748b; width: 40%;">Référence</td><td style="color: #1e293b; font-weight: 600; font-family: monospace;">${escapeHtml(reference)}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Titre</td><td style="color: #1e293b;">${escapeHtml(title)}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Statut final</td><td style="color: #1e293b;">${escapeHtml(statusLabel)}</td></tr>
            ${technicien ? `<tr><td style="padding: 8px 0; color: #64748b;">Technicien</td><td style="color: #1e293b;">${escapeHtml(technicien)}</td></tr>` : ''}
            <tr><td style="padding: 8px 0; color: #64748b;">Temps passé</td><td style="color: #1e293b;">${timeLabel}</td></tr>
          </table>
        </div>
        ${npsUrl ? `
        <div style="text-align: center; margin-top: 24px;">
          <p style="color: #64748b; font-size: 14px; margin-bottom: 12px;">Comment évaluez-vous notre intervention ?</p>
          <a href="${npsUrl}" style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Donner mon avis
          </a>
        </div>` : ''}
        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
          Cet email est envoyé automatiquement par DCB Technologies CRM.
        </p>
      </div>
    `,
    text: `Ticket clôturé\n\nRéférence : ${reference}\nTitre : ${title}\nStatut : ${statusLabel}${technicien ? `\nTechnicien : ${technicien}` : ''}\nTemps passé : ${timeLabel}\n${npsUrl ? `\nDonnez votre avis : ${npsUrl}\n` : ''}`,
  })
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`
  await sendMail({
    to: email,
    subject: 'Réinitialisation de votre mot de passe — DCB Technologies',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 32px;">
        <h2 style="color: #1e293b; margin-bottom: 8px;">Réinitialisation du mot de passe</h2>
        <p style="color: #475569; margin-bottom: 24px;">
          Vous avez demandé la réinitialisation de votre mot de passe DCB Technologies.<br>
          Ce lien est valable <strong>1 heure</strong>.
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; background: #4f46e5; color: white; text-decoration: none;
                  padding: 12px 24px; border-radius: 8px; font-weight: 600;">
          Réinitialiser mon mot de passe
        </a>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">
          Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.<br>
          Ce lien expirera automatiquement dans 1 heure.
        </p>
      </div>
    `,
    text: `Réinitialisation mot de passe DCB Technologies\n\nLien (valable 1h) :\n${resetUrl}\n\nSi vous n'avez pas demandé cette action, ignorez cet email.`,
  })
}
