import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { escapeHtml } from '../lib/serializers.js';

let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    auth: { user: 'apikey', pass: env.SENDGRID_API_KEY },
  });
  return transporter;
}

/** Returns true if an e-mail was actually handed to the SMTP relay, false if e-mail is not configured. */
export async function sendMail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<boolean> {
  if (!env.EMAIL_ENABLED) {
    console.warn(`[email] SENDGRID_API_KEY not set — not sending "${subject}" to ${to}`);
    return false;
  }
  await getTransporter().sendMail({ from: env.EMAIL_FROM, to, subject, html });
  return true;
}

export async function sendBookingConfirmation(to: string, mentorName: string, startTime: Date) {
  await sendMail({
    to,
    subject: 'Your mentor session is confirmed',
    html: `<p>Your session with <strong>${escapeHtml(mentorName)}</strong> is booked for ${escapeHtml(startTime.toUTCString())}.</p>`,
  });
}

export async function sendHighRiskAlert(to: string, studentName: string, score: number) {
  await sendMail({
    to,
    subject: `Placement risk alert: ${studentName}`,
    html: `<p><strong>${escapeHtml(studentName)}</strong>'s placement readiness score is <strong>${score.toFixed(1)}%</strong> (high risk). Consider scheduling a check-in with a mentor.</p>`,
  });
}

export async function sendSetPasswordEmail(to: string, name: string, url: string, hours: number) {
  return sendMail({
    to,
    subject: 'Set your EduAlert password',
    html: `<p>Hi ${escapeHtml(name)},</p><p>An EduAlert account has been created for you. <a href="${escapeHtml(url)}">Set your password</a> to sign in. This link expires in ${hours} hours and can be used once.</p>`,
  });
}

export async function sendResetEmail(to: string, url: string) {
  return sendMail({
    to,
    subject: 'Reset your EduAlert password',
    html: `<p>Click <a href="${escapeHtml(url)}">here</a> to reset your password. This link expires in 1 hour and can be used once. If you did not request this, ignore this e-mail.</p>`,
  });
}
