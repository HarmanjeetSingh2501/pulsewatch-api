import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { incidents } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export async function handleIncidentState(urlId: number, isUp: boolean) {
  const [openIncident] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.urlId, urlId), eq(incidents.status, 'open')))
    .limit(1);

  // Case 1: URL is down and no incident exists → open one
  if (!isUp && !openIncident) {
    await db.insert(incidents).values({
      urlId,
      status: 'open',
    });
    logger.warn({ urlId }, '🚨 Incident opened');
    return;
  }

  // Case 2: URL is up and an incident exists → close it
  if (isUp && openIncident) {
    await db
      .update(incidents)
      .set({ status: 'resolved', endedAt: new Date() })
      .where(eq(incidents.id, openIncident.id));
    logger.info({ urlId, incidentId: openIncident.id }, '✅ Incident resolved');
    return;
  }

  // Case 3: No change → do nothing
  // (down + incident open, or up + no incident)
}