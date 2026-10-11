console.log('████ urls.ts VERSION 2 loaded at', new Date().toISOString());
import { eq, and, gte, desc, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pings } from '../db/schema.js';
import { scoreAnomaly } from './anomaly.js';

export type UrlStatus = 'up' | 'degraded' | 'down' | 'paused' | 'unknown';

export interface UrlStatusResult {
  status: UrlStatus;
  zScore: number | null;
  baselineMean: number | null;
  baselineStdDev: number | null;
  latestResponseMs: number | null;
  sampleSize: number;
}

/**
 * Compute the current status of a URL by looking at its recent pings.
 *
 * Status rules:
 *   - If URL is paused → 'paused'
 *   - If the latest ping is down → 'down'
 *   - If the latest ping is up but z-score >= 3 → 'degraded'
 *   - Otherwise → 'up'
 *
 * Baseline window: last 1 hour of successful pings.
 */
export async function computeUrlStatus(
  urlId: number,
  isActive: boolean
): Promise<UrlStatusResult> {
  if (!isActive) {
    return {
      status: 'paused',
      zScore: null,
      baselineMean: null,
      baselineStdDev: null,
      latestResponseMs: null,
      sampleSize: 0,
    };
  }

  // Latest ping
  const [latest] = await db
    .select()
    .from(pings)
    .where(eq(pings.urlId, urlId))
    .orderBy(desc(pings.checkedAt))
    .limit(1);

  if (!latest) {
    return {
      status: 'unknown',
      zScore: null,
      baselineMean: null,
      baselineStdDev: null,
      latestResponseMs: null,
      sampleSize: 0,
    };
  }

  // If latest ping was down, we're down. No need to check anomalies.
  if (!latest.isUp) {
    return {
      status: 'down',
      zScore: null,
      baselineMean: null,
      baselineStdDev: null,
      latestResponseMs: null,
      sampleSize: 0,
    };
  }

  // Latest ping was up. Now check for anomaly.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Fetch successful pings from the last hour for the baseline
  const baselinePings = await db
    .select({ responseTimeMs: pings.responseTimeMs })
    .from(pings)
    .where(
      and(
        eq(pings.urlId, urlId),
        eq(pings.isUp, true),
        gte(pings.checkedAt, oneHourAgo),
        isNotNull(pings.responseTimeMs)
      )
    )
    .orderBy(desc(pings.checkedAt))
    .limit(120); // last 120 = 1 hour at 30s interval

  const baseline = baselinePings
    .map((p) => p.responseTimeMs)
    .filter((t): t is number => t !== null && t > 0);

  const currentResponse = latest.responseTimeMs;

  // Not enough data to judge → treat as 'up'
  if (baseline.length < 5 || currentResponse === null) {
    return {
      status: 'up',
      zScore: null,
      baselineMean: null,
      baselineStdDev: null,
      latestResponseMs: currentResponse,
      sampleSize: baseline.length,
    };
  }

  const result = scoreAnomaly(currentResponse, baseline);

  return {
    status: result.isAnomalous ? 'degraded' : 'up',
    zScore: result.zScore,
    baselineMean: result.mean,
    baselineStdDev: result.stdDev,
    latestResponseMs: currentResponse,
    sampleSize: result.sampleSize,
  };
}