import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { urls, pings } from "../../db/schema.js";
import { computeUrlStatus } from "../../lib/url-status.js";
import { scheduleUrl, unscheduleUrl } from "../../worker/loop.js";

// ─── Validation Schemas ───────────────────────────────────
const createUrlSchema = z.object({
  url: z.string().url("Must be a valid URL"),
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
  // ─── GET /api/v1/urls — list all URLs for the current user ───
  app.get("/", { onRequest: [app.authenticate] }, async (request, reply) => {
    const userId = (request.user as { userId: number }).userId;

    const urlList = await db
      .select()
      .from(urls)
      .where(eq(urls.userId, userId))
      .orderBy(desc(urls.createdAt));

    if (urlList.length === 0) {
      return reply.send([]);
    }

    const urlIds = urlList.map((u) => u.id);
    const recentPings = await db
      .select()
      .from(pings)
      .where(inArray(pings.urlId, urlIds))
      .orderBy(desc(pings.checkedAt))
      .limit(500);

    const latestByUrl = new Map<number, (typeof recentPings)[number]>();
    for (const ping of recentPings) {
      if (!latestByUrl.has(ping.urlId)) {
        latestByUrl.set(ping.urlId, ping);
      }
    }

    const enriched = await Promise.all(
      urlList.map(async (url) => {
        const latest = latestByUrl.get(url.id);
        const statusResult = await computeUrlStatus(url.id, url.isActive);

        return {
          ...url,
          recentPings: latest ? [latest] : [],
          status: statusResult.status,
          zScore: statusResult.zScore,
          baselineMean: statusResult.baselineMean,
          baselineStdDev: statusResult.baselineStdDev,
        };
      }),
    );

    return reply.send(enriched);
  });

  // ─── POST /api/v1/urls — create a URL for the current user ───
  app.post("/", { onRequest: [app.authenticate] }, async (request, reply) => {
    const body = createUrlSchema.parse(request.body);
    const userId = (request.user as { userId: number }).userId;

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

    // Add to the in-memory worker schedule (first check runs on the next tick)
    scheduleUrl(created);

    return reply.status(201).send(created);
  });

  // ─── GET /api/v1/urls/:id/pings ──────────────────────────
  app.get(
    "/:id/pings",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const { limit } = listQuerySchema.parse(request.query);
      const userId = (request.user as { userId: number }).userId;

      const [url] = await db
        .select()
        .from(urls)
        .where(and(eq(urls.id, id), eq(urls.userId, userId)))
        .limit(1);

      if (!url) {
        return reply.status(404).send({ error: "URL not found" });
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
    },
  );

  // ─── GET /api/v1/urls/:id ────────────────────────────────
  app.get("/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const userId = (request.user as { userId: number }).userId;

    const [url] = await db
      .select()
      .from(urls)
      .where(and(eq(urls.id, id), eq(urls.userId, userId)))
      .limit(1);

    if (!url) {
      return reply.status(404).send({ error: "URL not found" });
    }

    const recentPings = await db
      .select()
      .from(pings)
      .where(eq(pings.urlId, id))
      .orderBy(desc(pings.checkedAt))
      .limit(50);

    return reply.send({ ...url, recentPings });
  });

  // ─── PATCH /api/v1/urls/:id ──────────────────────────────
  app.patch(
    "/:id",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const body = updateUrlSchema.parse(request.body);
      const userId = (request.user as { userId: number }).userId;

      const [updated] = await db
        .update(urls)
        .set(body)
        .where(and(eq(urls.id, id), eq(urls.userId, userId)))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: "URL not found" });
      }

      // Handles pause (isActive: false), resume and interval changes
      scheduleUrl(updated);

      return reply.send(updated);
    },
  );

  // ─── DELETE /api/v1/urls/:id ─────────────────────────────
  app.delete(
    "/:id",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const userId = (request.user as { userId: number }).userId;

      const [deleted] = await db
        .delete(urls)
        .where(and(eq(urls.id, id), eq(urls.userId, userId)))
        .returning();

      if (!deleted) {
        return reply.status(404).send({ error: "URL not found" });
      }

      unscheduleUrl(deleted.id);

      return reply.status(204).send();
    },
  );
}
