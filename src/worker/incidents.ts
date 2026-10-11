import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { incidents, urls, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { generateIncidentSummary } from './ai.js';
import { sendDownAlert, sendRecoveryAlert } from '../lib/email.js';

export async function handleIncidentState(urlId: number, isUp: boolean) {
  const [openIncident] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.urlId, urlId), eq(incidents.status, 'open')))
    .limit(1);

  // ─── Case 1: URL is down and no incident exists → open one ───
  if (!isUp && !openIncident) {
    const [newIncident] = await db
      .insert(incidents)
      .values({ urlId, status: 'open' })
      .returning();

    logger.warn({ urlId, incidentId: newIncident.id }, '🚨 Incident opened');

    // Fire-and-forget the down alert email
    notifyDown(urlId, newIncident).catch((err) =>
      logger.error({ err, urlId }, 'Down alert email failed')
    );

    return;
  }

  // ─── Case 2: URL is up and an incident exists → close it ─────
  if (isUp && openIncident) {
    await db
      .update(incidents)
      .set({ status: 'resolved', endedAt: new Date() })
      .where(eq(incidents.id, openIncident.id));

    logger.info(
      { urlId, incidentId: openIncident.id },
      '✅ Incident resolved'
    );

    // Fire-and-forget the AI summary
    generateIncidentSummary(openIncident.id).catch((err) => {
      logger.error(
        { err, incidentId: openIncident.id },
        'Background AI summary failed'
      );
    });

    // Fire-and-forget the recovery alert email
    notifyRecovery(urlId, openIncident).catch((err) =>
      logger.error({ err, urlId }, 'Recovery alert email failed')
    );

    return;
  }

  // ─── Case 3: No change → do nothing ─────────────────────────
}

// ─── Email helpers ─────────────────────────────────────────

async function notifyDown(
  urlId: number,
  incident: typeof incidents.$inferSelect
) {
  const [urlRow] = await db
    .select()
    .from(urls)
    .where(eq(urls.id, urlId))
    .limit(1);

  if (!urlRow) return;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, urlRow.userId))
    .limit(1);

  if (!user) return;

  await sendDownAlert({
    to: user.email,
    urlName: urlRow.name,
    url: urlRow.url,
    status: 'down',
    startedAt: incident.startedAt,
    incidentId: incident.id,
  });
}

async function notifyRecovery(
  urlId: number,
  incident: typeof incidents.$inferSelect
) {
  const [urlRow] = await db
    .select()
    .from(urls)
    .where(eq(urls.id, urlId))
    .limit(1);

  if (!urlRow) return;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, urlRow.userId))
    .limit(1);

  if (!user) return;

  await sendRecoveryAlert({
    to: user.email,
    urlName: urlRow.name,
    url: urlRow.url,
    status: 'up',
    startedAt: incident.startedAt,
    endedAt: new Date(),
    incidentId: incident.id,
    aiSummary: null, // AI summary is generated in parallel; not included in the email yet
  });
}