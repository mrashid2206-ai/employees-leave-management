import nodemailer from 'nodemailer'

const port = parseInt(process.env.SMTP_PORT || '587')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port,
  // 465 is TLS from the first byte. Anything else (587) starts in plaintext and upgrades
  // with STARTTLS. requireTLS makes that upgrade mandatory, so a server or attacker that
  // drops STARTTLS can't get SMTP_PASS sent in the clear.
  secure: port === 465,
  requireTLS: port !== 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}

// Send an email in-process. Returns false (never throws) when SMTP is unconfigured,
// the recipient is missing, or delivery fails — callers treat email as best-effort.
export async function sendMail(opts: { to?: string; subject: string; html: string }): Promise<boolean> {
  if (!isEmailConfigured() || !opts.to) return false
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    })
    return true
  } catch (err) {
    console.error('Email error:', err)
    return false
  }
}
