import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
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
