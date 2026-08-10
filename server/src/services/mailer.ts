import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
})

const FROM = process.env.SMTP_FROM || 'DCB Technologies <noreply@dcb-technologies.fr>'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

/** Envoi générique — retourne silencieusement si le mailer n'est pas configuré */
export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }): Promise<void> {
  if (!process.env.SMTP_HOST && !process.env.SMTP_USER) return
  await transporter.sendMail({ from: FROM, ...opts })
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
  await transporter.sendMail({
    from: FROM,
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
