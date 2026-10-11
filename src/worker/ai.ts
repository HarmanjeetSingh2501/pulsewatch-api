import { GoogleGenAI } from '@google/genai';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { incidents, pings, urls } from '../db/schema.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Prompt version — bump this if you change the prompt so you can tell
// which summaries were generated with which prompt.
const PROMPT_VERSION = 1;

// Model to use — Gemini 2.5 Flash is fast and cheap on the free tier.
const GEMINI_MODEL = 'gemini-3.8-flash';

// ─── Gemini client ────────────────────────────────────────
const ai = env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })
  : null;

// ─── Incident context ─────────────────────────────────────
interface IncidentContext {
  urlName: string;
  url: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMinutes: number;
  errorTypes: string[];
  pingsDuringIncident: Array<{
    statusCode: number | null;
    responseTimeMs: number | null;
    isUp: boolean;
    errorMessage: string | null;
  }>;
  pingsBeforeIncident: Array<{
    responseTimeMs: number | null;
  }>;
}

// ─── Build context from DB ────────────────────────────────
async function buildContext(
  incidentId: number
): Promise<IncidentContext | null> {
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!incident) return null;

  const [url] = await db
    .select()
    .from(urls)
    .where(eq(urls.id, incident.urlId))
    .limit(1);

  if (!url) return null;

  const start = new Date(incident.startedAt);
  const end = incident.endedAt ? new Date(incident.endedAt) : new Date();
  const durationMinutes = Math.round(
    (end.getTime() - start.getTime()) / 60000
  );

  // Pings during the incident window
  const incidentPings = await db
    .select()
    .from(pings)
    .where(
      and(
        eq(pings.urlId, incident.urlId),
        gte(pings.checkedAt, start),
        incident.endedAt ? lte(pings.checkedAt, end) : undefined
      )
    )
    .orderBy(desc(pings.checkedAt))
    .limit(50);

  // Pings 5 minutes before the incident (baseline)
  const baselineStart = new Date(start.getTime() - 5 * 60 * 1000);
  const baselinePings = await db
    .select()
    .from(pings)
    .where(
      and(
        eq(pings.urlId, incident.urlId),
        gte(pings.checkedAt, baselineStart),
        lte(pings.checkedAt, start)
      )
    )
    .orderBy(desc(pings.checkedAt))
    .limit(20);

  return {
    urlName: url.name,
    url: url.url,
    startedAt: start,
    endedAt: incident.endedAt ? end : null,
    durationMinutes,
    errorTypes: [
      ...new Set(
        incidentPings
          .map((p) => p.errorMessage)
          .filter((e): e is string => !!e)
      ),
    ],
    pingsDuringIncident: incidentPings.map((p) => ({
      statusCode: p.statusCode,
      responseTimeMs: p.responseTimeMs,
      isUp: p.isUp,
      errorMessage: p.errorMessage,
    })),
    pingsBeforeIncident: baselinePings.map((p) => ({
      responseTimeMs: p.responseTimeMs,
    })),
  };
}

// ─── Prompt builder ───────────────────────────────────────
function buildPrompt(ctx: IncidentContext): string {
  const statusSummary = summarizeStatusCodes(ctx.pingsDuringIncident);
  const latencyTrend = summarizeLatency(ctx);

  return `You are analyzing an uptime monitoring incident. Write a clear, factual, 2-3 sentence summary for an operations engineer. No bullet points, no markdown, just plain prose.

Service: ${ctx.urlName} (${ctx.url})
Incident started: ${ctx.startedAt.toISOString()}
${
  ctx.endedAt
    ? `Incident ended: ${ctx.endedAt.toISOString()}`
    : 'Incident is still ongoing'
}
Duration: ${ctx.durationMinutes} minutes
${
  ctx.errorTypes.length > 0
    ? `Error types observed: ${ctx.errorTypes.join(', ')}`
    : ''
}

Status codes during incident:
${statusSummary}

Latency trend:
${latencyTrend}

Write the summary now. Include:
1. What happened (what failed, for how long)
2. What the data suggests about the cause (if anything)
3. What the recovery looked like (if it resolved)

Keep it factual. If you don't have enough data to say something, don't speculate.`;
}

function summarizeStatusCodes(
  pings: IncidentContext['pingsDuringIncident']
): string {
  const counts: Record<string, number> = {};
  for (const ping of pings) {
    const key = ping.statusCode
      ? String(ping.statusCode)
      : ping.errorMessage || 'no response';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => `  - ${k}: ${v} occurrences`)
    .join('\n');
}

function summarizeLatency(ctx: IncidentContext): string {
  const validBefore = ctx.pingsBeforeIncident
    .map((p) => p.responseTimeMs)
    .filter((t): t is number => t !== null && t > 0);

  const validDuring = ctx.pingsDuringIncident
    .filter((p) => p.isUp)
    .map((p) => p.responseTimeMs)
    .filter((t): t is number => t !== null && t > 0);

  const avgBefore =
    validBefore.length > 0
      ? Math.round(
          validBefore.reduce((a, b) => a + b, 0) / validBefore.length
        )
      : null;

  const avgDuring =
    validDuring.length > 0
      ? Math.round(
          validDuring.reduce((a, b) => a + b, 0) / validDuring.length
        )
      : null;

  const lines: string[] = [];
  if (avgBefore !== null) {
    lines.push(`  - Average response time before incident: ${avgBefore}ms`);
  }
  if (avgDuring !== null) {
    lines.push(`  - Average response time during incident: ${avgDuring}ms`);
  }
  if (lines.length === 0) {
    lines.push('  - No valid latency data during the incident');
  }
  return lines.join('\n');
}

// ─── Main entry point ─────────────────────────────────────
export async function generateIncidentSummary(
  incidentId: number
): Promise<void> {
  if (!ai) {
    logger.warn(
      { incidentId },
      'Gemini not configured (GEMINI_API_KEY missing) — skipping summary'
    );
    return;
  }

  // Skip if we already have a summary
  const [existing] = await db
    .select({ aiSummary: incidents.aiSummary })
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (existing?.aiSummary) {
    logger.debug({ incidentId }, 'Incident already has a summary, skipping');
    return;
  }

  try {
    const ctx = await buildContext(incidentId);
    if (!ctx) {
      logger.warn(
        { incidentId },
        'Could not build context, skipping summary'
      );
      return;
    }

    const prompt = buildPrompt(ctx);

    logger.info({ incidentId }, 'Calling Gemini for incident summary');
    const start = Date.now();

    const response = await ai.models.generateContent({
  model: GEMINI_MODEL,
  contents: prompt,
  config: {
    temperature: 0.3,
    maxOutputTokens: 1000,
    // Disable thinking — we just want the summary, not reasoning tokens
    thinkingConfig: {
      thinkingBudget: 0,
    },
  },
});

    const summary = response.text?.trim() ?? '';

    if (!summary) {
      logger.warn({ incidentId }, 'Gemini returned empty response');
      return;
    }

    const elapsedMs = Date.now() - start;

    await db
      .update(incidents)
      .set({
        aiSummary: summary,
        promptVersion: PROMPT_VERSION,
        aiGeneratedAt: new Date(),
      })
      .where(eq(incidents.id, incidentId));

    logger.info(
      { incidentId, elapsedMs, summaryLength: summary.length },
      'AI summary generated'
    );
  } catch (err) {
    logger.error({ err, incidentId }, 'Failed to generate AI summary');
    // Do not throw — the worker loop should keep running
  }
}