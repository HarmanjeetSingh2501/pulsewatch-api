import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { env, isDev } from '../config/env.js';
import { errorHandler } from './plugins/errorHandler.js';
import { healthRoutes } from './routes/health.js';
import { urlRoutes } from './routes/urls.js';
import { incidentRoutes } from './routes/incidents.js';
import { authRoutes } from './routes/auth.js';
import { authenticate } from './middleware/auth.js';

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
      : { level: 'info' },
  });

  // ─── Plugins ────────────────────────────────────────────
  await app.register(cors, {
    origin: (origin, cb) => {
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

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '7d' },
  });

  // ─── Decorators ─────────────────────────────────────────
  app.decorate('authenticate', authenticate);

  // ─── Error Handler ──────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ─── Routes ─────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(urlRoutes, { prefix: '/api/v1/urls' });
  await app.register(incidentRoutes, { prefix: '/api/v1/incidents' });

  return app;
}