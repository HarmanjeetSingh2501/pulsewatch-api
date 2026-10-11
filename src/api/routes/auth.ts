import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  // ─── POST /api/v1/auth/register ──────────────────────────
  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (existing.length > 0) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        passwordHash,
      })
      .returning();

    const token = app.jwt.sign({ userId: user.id, email: user.email });

    return reply.status(201).send({
      token,
      user: { id: user.id, email: user.email },
    });
  });

  // ─── POST /api/v1/auth/login ─────────────────────────────
  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const token = app.jwt.sign({ userId: user.id, email: user.email });

    return reply.send({
      token,
      user: { id: user.id, email: user.email },
    });
  });

  // ─── GET /api/v1/auth/me ─────────────────────────────────
  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user as { userId: number };

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return reply.send(user);
  });
}