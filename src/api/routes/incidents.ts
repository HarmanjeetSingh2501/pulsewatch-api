import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { incidents, urls, pings } from '../../db/schema.js';

// ─── Validation Schemas ───────────────────────────────────
const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const listQuerySchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  urlId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

// ─── Routes ───────────────────────────────────────────────
export async function incidentRoutes(app: FastifyInstance) {
  // GET /api/v1/incidents — list incidents
  app.get('/', async (request, reply) => {
    const userId = 1; // TODO: from JWT in Week 2
    const { status, urlId, limit } = listQuerySchema.parse(request.query);

    // Get user's URL IDs (only return incidents for their URLs)
    const userUrls = await db
      .select({ id: urls.id })
      .from(urls)
      .where(eq(urls.userId, userId));

    const urlIds = userUrls.map((u) => u.id);

    if (urlIds.length === 0) {
      return reply.send([]);
    }

    // Build filter conditions
    const conditions = [inArray(incidents.urlId, urlIds)];
    if (status) conditions.push(eq(incidents.status, status));
    if (urlId) conditions.push(eq(incidents.urlId, urlId));

    const list = await db
      .select({
        id: incidents.id,
        urlId: incidents.urlId,
        urlName: urls.name,
        url: urls.url,
        startedAt: incidents.startedAt,
        endedAt: incidents.endedAt,
        status: incidents.status,
        errorType: incidents.errorType,
        aiSummary: incidents.aiSummary,
      })
      .from(incidents)
      .leftJoin(urls, eq(incidents.urlId, urls.id))
      .where(and(...conditions))
      .orderBy(desc(incidents.startedAt))
      .limit(limit);

    return reply.send(list);
  });

  // GET /api/v1/incidents/:id — one incident + pings during outage
  app.get('/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const userId = 1;

    const [incident] = await db
      .select({
        id: incidents.id,
        urlId: incidents.urlId,
        urlName: urls.name,
        url: urls.url,
        startedAt: incidents.startedAt,
        endedAt: incidents.endedAt,
        status: incidents.status,
        errorType: incidents.errorType,
        aiSummary: incidents.aiSummary,
        promptVersion: incidents.promptVersion,
        aiGeneratedAt: incidents.aiGeneratedAt,
      })
      .from(incidents)
      .leftJoin(urls, eq(incidents.urlId, urls.id))
      .where(and(eq(incidents.id, id), eq(urls.userId, userId)))
      .limit(1);

    if (!incident) {
      return reply.status(404).send({ error: 'Incident not found' });
    }

    const incidentPings = await db
      .select()
      .from(pings)
      .where(eq(pings.urlId, incident.urlId))
      .orderBy(desc(pings.checkedAt))
      .limit(200);

    return reply.send({ ...incident, pings: incidentPings });
  });
}