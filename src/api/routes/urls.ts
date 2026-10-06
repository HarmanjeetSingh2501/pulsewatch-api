import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { urls, pings } from '../../db/schema.js';

// ─── Validation Schemas ───────────────────────────────────
const createUrlSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  name: z.string().min(1).max(100),
  checkIntervalSeconds: z.number().int().min(30).max(3600).optional(),
});

const updateUrlSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  checkIntervalSeconds: z.number().int().min(30).max(3600).optional(),
  isActive: z.boolean().optional(),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ─── Routes ───────────────────────────────────────────────
export async function urlRoutes(app: FastifyInstance) {
  // GET /api/v1/urls — list all URLs
  app.get('/', async (request, reply) => {
    const userId = 1; // TODO: from JWT in Week 2
    const list = await db
      .select()
      .from(urls)
      .where(eq(urls.userId, userId))
      .orderBy(desc(urls.createdAt));

    return reply.send(list);
  });

  // POST /api/v1/urls — create a URL
  app.post('/', async (request, reply) => {
    const body = createUrlSchema.parse(request.body);
    const userId = 1;

    const [created] = await db
      .insert(urls)
      .values({
        userId,
        url: body.url,
        name: body.name,
        checkIntervalSeconds: body.checkIntervalSeconds ?? 30,
        nextCheckAt: new Date(),
      })
      .returning();

    return reply.status(201).send(created);
  });

  // ⚠️ IMPORTANT: /:id/pings MUST come BEFORE /:id
  // Otherwise Fastify treats "pings" as part of the :id

  // GET /api/v1/urls/:id/pings — paginated ping history
  app.get('/:id/pings', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { limit } = listQuerySchema.parse(request.query);
    const userId = 1;

    // Verify URL belongs to user
    const [url] = await db
      .select()
      .from(urls)
      .where(and(eq(urls.id, id), eq(urls.userId, userId)))
      .limit(1);

    if (!url) {
      return reply.status(404).send({ error: 'URL not found' });
    }

    const history = await db
      .select()
      .from(pings)
      .where(eq(pings.urlId, id))
      .orderBy(desc(pings.checkedAt))
      .limit(limit);

    return reply.send({
      urlId: id,
      count: history.length,
      pings: history,
    });
  });

  // GET /api/v1/urls/:id — get one URL with recent pings
  app.get('/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const userId = 1;

    const [url] = await db
      .select()
      .from(urls)
      .where(and(eq(urls.id, id), eq(urls.userId, userId)))
      .limit(1);

    if (!url) {
      return reply.status(404).send({ error: 'URL not found' });
    }

    const recentPings = await db
      .select()
      .from(pings)
      .where(eq(pings.urlId, id))
      .orderBy(desc(pings.checkedAt))
      .limit(50);

    return reply.send({ ...url, recentPings });
  });

  // PATCH /api/v1/urls/:id — update a URL
  app.patch('/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateUrlSchema.parse(request.body);
    const userId = 1;

    const [updated] = await db
      .update(urls)
      .set(body)
      .where(and(eq(urls.id, id), eq(urls.userId, userId)))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: 'URL not found' });
    }

    return reply.send(updated);
  });

  // DELETE /api/v1/urls/:id — remove a URL
  app.delete('/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const userId = 1;

    const [deleted] = await db
      .delete(urls)
      .where(and(eq(urls.id, id), eq(urls.userId, userId)))
      .returning();

    if (!deleted) {
      return reply.status(404).send({ error: 'URL not found' });
    }

    return reply.status(204).send();
  });
}