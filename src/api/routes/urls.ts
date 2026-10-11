import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { urls, pings } from "../../db/schema.js";
import { computeUrlStatus } from "../../lib/url-status.js";

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
  // ─── GET /api/v1/urls — list all URLs with latest ping ───
  // GET /api/v1/urls — list all URLs with latest ping AND computed status
  app.get("/", async (request, reply) => {
    const userId = 1; // TODO: from JWT

    // Fetch all URLs for the user
    const urlList = await db
      .select()
      .from(urls)
      .where(eq(urls.userId, userId))
      .orderBy(desc(urls.createdAt));

    if (urlList.length === 0) {
      return reply.send([]);
    }

    // Fetch recent pings for all URLs in one query
    const urlIds = urlList.map((u) => u.id);
    const recentPings = await db
      .select()
      .from(pings)
      .where(inArray(pings.urlId, urlIds))
      .orderBy(desc(pings.checkedAt))
      .limit(500);

    // Group by URL, take latest 1 per URL
    const latestByUrl = new Map<number, (typeof recentPings)[number]>();
    for (const ping of recentPings) {
      if (!latestByUrl.has(ping.urlId)) {
        latestByUrl.set(ping.urlId, ping);
      }
    }

    // Compute status for each URL (parallel)
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

  // ─── POST /api/v1/urls — create a URL ────────────────────
  app.post("/", async (request, reply) => {
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

  // ─── GET /api/v1/urls/:id/pings — paginated history ──────
  // ⚠️ MUST come before /:id route
  app.get("/:id/pings", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { limit } = listQuerySchema.parse(request.query);
    const userId = 1;

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
  });

  // ─── GET /api/v1/urls/:id — one URL + recent pings ───────
  app.get("/:id", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const userId = 1;

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

  // ─── PATCH /api/v1/urls/:id — update a URL ───────────────
  app.patch("/:id", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateUrlSchema.parse(request.body);
    const userId = 1;

    const [updated] = await db
      .update(urls)
      .set(body)
      .where(and(eq(urls.id, id), eq(urls.userId, userId)))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: "URL not found" });
    }

    return reply.send(updated);
  });

  // ─── DELETE /api/v1/urls/:id — remove a URL ──────────────
  app.delete("/:id", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const userId = 1;

    const [deleted] = await db
      .delete(urls)
      .where(and(eq(urls.id, id), eq(urls.userId, userId)))
      .returning();

    if (!deleted) {
      return reply.status(404).send({ error: "URL not found" });
    }

    return reply.status(204).send();
  });
}
