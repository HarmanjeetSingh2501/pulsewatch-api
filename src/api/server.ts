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
  origin: (origin, cb) => {
    // Allow: no origin (Postman), localhost dev, or any vercel.app subdomain
    if (
      !origin ||
      origin === 'http://localhost:3001' ||
      origin.endsWith('.vercel.app') ||
      origin === env.FRONTEND_URL
    ) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

  // ─── Error Handler ──────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ─── Routes ─────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/' });
  await app.register(urlRoutes, { prefix: '/api/v1/urls' });
  await app.register(incidentRoutes, { prefix: '/api/v1/incidents' });

  return app;
}