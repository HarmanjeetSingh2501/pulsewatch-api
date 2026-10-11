import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const resend = env.RESEND_API_KEY
  ? new Resend(env.RESEND_API_KEY)
  : null;

// Configure this once you verify a domain on Resend.
// For dev, Resend's test domain `onboarding@resend.dev` works.
const FROM_EMAIL = 'PulseWatch <onboarding@resend.dev>';

export interface AlertEmailData {
  to: string;
  urlName: string;
  url: string;
  status: 'down' | 'up';
  startedAt: Date;
  endedAt?: Date;
  aiSummary?: string | null;
  incidentId: number;
}

async function send(email: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!resend) {
    logger.warn({ to: email.to }, 'RESEND_API_KEY missing — skipping email');
    return false;
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email.to,
      subject: email.subject,
      html: email.html,
    });
    logger.info({ to: email.to, subject: email.subject }, 'Email sent');
    return true;
  } catch (err) {
    logger.error({ err, to: email.to }, 'Failed to send email');
    return false;
  }
}

// ─── Templates ────────────────────────────────────────────

function downTemplate(data: AlertEmailData): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="border-left: 4px solid #dc2626; padding-left: 16px; margin-bottom: 24px;">
        <p style="color: #dc2626; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 8px;">
          Service Down
        </p>
        <h1 style="margin: 0; font-size: 24px; color: #1b2c22;">
          ${data.urlName}
        </h1>
        <p style="margin: 8px 0 0; color: #666; font-size: 14px;">
          ${data.url}
        </p>
      </div>

      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        PulseWatch detected that <strong>${data.urlName}</strong> is not responding.
      </p>

      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0; color: #991b1b; font-size: 13px;">
          <strong>Started:</strong> ${data.startedAt.toUTCString()}
        </p>
      </div>

      <p style="color: #666; font-size: 14px; line-height: 1.6;">
        We'll send you another email when this incident resolves, along with an
        AI-generated summary of what happened.
      </p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />

      <p style="color: #999; font-size: 12px;">
        PulseWatch — free uptime monitoring with AI incident summaries
      </p>
    </div>
  `;
}

function upTemplate(data: AlertEmailData): string {
  const durationMs = data.endedAt
    ? data.endedAt.getTime() - data.startedAt.getTime()
    : 0;
  const durationMin = Math.round(durationMs / 60000);

  return `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="border-left: 4px solid #16a34a; padding-left: 16px; margin-bottom: 24px;">
        <p style="color: #16a34a; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 8px;">
          Service Recovered
        </p>
        <h1 style="margin: 0; font-size: 24px; color: #1b2c22;">
          ${data.urlName}
        </h1>
        <p style="margin: 8px 0 0; color: #666; font-size: 14px;">
          ${data.url}
        </p>
      </div>

      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        <strong>${data.urlName}</strong> is responding again.
      </p>

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0 0 4px; color: #14532d; font-size: 13px;">
          <strong>Down since:</strong> ${data.startedAt.toUTCString()}
        </p>
        <p style="margin: 0; color: #14532d; font-size: 13px;">
          <strong>Duration:</strong> ${durationMin} minute${durationMin === 1 ? '' : 's'}
        </p>
      </div>

      ${data.aiSummary ? `
        <div style="background: linear-gradient(180deg, #f4faee, #fbfcf9); border: 1px solid #e6ecdf; border-radius: 12px; padding: 16px; margin: 24px 0;">
          <p style="margin: 0 0 8px; color: #5c8a4d; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
            AI Summary
          </p>
          <p style="margin: 0; color: #3d4d42; font-size: 14px; line-height: 1.65;">
            ${data.aiSummary}
          </p>
        </div>
      ` : ''}

      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />

      <p style="color: #999; font-size: 12px;">
        PulseWatch — free uptime monitoring with AI incident summaries
      </p>
    </div>
  `;
}

// ─── Public API ───────────────────────────────────────────

export async function sendDownAlert(data: AlertEmailData): Promise<void> {
  await send({
    to: data.to,
    subject: `🔴 ${data.urlName} is down`,
    html: downTemplate(data),
  });
}

export async function sendRecoveryAlert(data: AlertEmailData): Promise<void> {
  await send({
    to: data.to,
    subject: `✅ ${data.urlName} has recovered`,
    html: upTemplate(data),
  });
}