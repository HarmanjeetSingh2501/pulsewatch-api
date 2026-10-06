import { lte, eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { urls, pings } from '../db/schema.js';
import { pingUrl } from './ping.js';
import { handleIncidentState } from './incidents.js';
import { logger } from '../lib/logger.js';

const TICK_INTERVAL_MS = 10_000; // Check every 10s for due URLs

export function startWorkerLoop() {
  logger.info('Worker loop started');

  setInterval(async () => {
    try {
      const now = new Date();

      const dueUrls = await db
        .select()
        .from(urls)
        .where(and(eq(urls.isActive, true), lte(urls.nextCheckAt, now)));

      if (dueUrls.length === 0) return;

      logger.debug({ count: dueUrls.length }, 'Pinging due URLs');

      // Ping all due URLs in parallel
      await Promise.allSettled(
        dueUrls.map(async (url) => {
          const result = await pingUrl(url.url);

          // 1. Save the ping
          await db.insert(pings).values({
            urlId: url.id,
            statusCode: result.statusCode,
            responseTimeMs: result.responseTimeMs,
            isUp: result.isUp,
            errorMessage: result.errorMessage,
          });

          // 2. Schedule the next check
          await db
            .update(urls)
            .set({
              nextCheckAt: new Date(
                Date.now() + url.checkIntervalSeconds * 1000
              ),
            })
            .where(eq(urls.id, url.id));

          // 3. Handle incident transitions
          await handleIncidentState(url.id, result.isUp);

          logger.debug(
            {
              urlId: url.id,
              url: url.url,
              isUp: result.isUp,
              statusCode: result.statusCode,
              responseTimeMs: result.responseTimeMs,
            },
            'Ping complete'
          );
        })
      );
    } catch (err) {
      logger.error({ err }, 'Worker loop tick failed');
    }
  }, TICK_INTERVAL_MS);
}