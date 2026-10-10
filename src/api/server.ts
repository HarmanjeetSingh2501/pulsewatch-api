import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env, isDev } from '../config/env.js';
import { errorHandler } from './plugins/errorHandler.js';
import { healthRoutes } from './routes/health.js';
import { urlRoutes } from './routes/urls.js';
import { incidentRoutes } from './routes/incidents.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    logger: isDev
      ? {
          level: 'debug',
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        }
      : {
          level: 'info',
        },
  });

  // ─── Plugins ────────────────────────────────────────────
  await app.register(cors, {
    origin: [env.FRONTEND_URL, 'http://localhost:3001'],
    credentials: true,
  });

  // ─── Error Handler ──────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ─── Routes ─────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/' });
  await app.register(urlRoutes, { prefix: '/api/v1/urls' });
  await app.register(incidentRoutes, { prefix: '/api/v1/incidents' });

  return app;
}