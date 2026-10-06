import { FastifyInstance } from 'fastify';
import { checkDbConnection } from '../../db/client.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (request, reply) => {
    const dbOk = await checkDbConnection();

    const status = dbOk ? 'ok' : 'degraded';
    const code = dbOk ? 200 : 503;

    return reply.status(code).send({
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: dbOk ? 'connected' : 'disconnected',
    });
  });
}