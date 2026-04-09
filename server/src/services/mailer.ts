import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
})

const FROM = process.env.SMTP_FROM || 'MonCRM <noreply@crm.local>'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Réinitialisation de votre mot de passe — MonCRM',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 32px;">
        <h2 style="color: #1e293b; margin-bottom: 8px;">Réinitialisation du mot de passe</h2>
        <p style="color: #475569; margin-bottom: 24px;">
          Vous avez demandé la réinitialisation de votre mot de passe MonCRM.<br>
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
    text: `Réinitialisation mot de passe MonCRM\n\nLien (valable 1h) :\n${resetUrl}\n\nSi vous n'avez pas demandé cette action, ignorez cet email.`,
  })
}
