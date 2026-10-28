import { FastifyInstance } from "fastify";
import { checkDbConnection } from "../../db/client.js";

export async function healthRoutes(app: FastifyInstance) {
  // Liveness only: no DB access, so keep-alive pings never wake Neon
  // and never return 503 because of a database problem.
  app.get("/health", async (_request, reply) => {
    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // Manual DB check. Do NOT point cron-job.org at this one.
  app.get("/health/db", async (_request, reply) => {
    const dbOk = await checkDbConnection();

    return reply.status(dbOk ? 200 : 503).send({
      status: dbOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      database: dbOk ? "connected" : "disconnected",
    });
  });
}
