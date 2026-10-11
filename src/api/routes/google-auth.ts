import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export async function googleAuthRoutes(app: FastifyInstance) {
  // ─── GET /api/v1/auth/google ────────────────────────────
  // Step 1 of OAuth: redirect user to Google's consent screen
  app.get('/google', async (request, reply) => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) {
      return reply.status(500).send({ error: 'Google OAuth not configured' });
    }

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
    });

    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // ─── GET /api/v1/auth/google/callback ───────────────────
  // Step 2 of OAuth: Google redirects here with a code
  app.get('/google/callback', async (request, reply) => {
    const query = request.query as { code?: string; error?: string };

    if (query.error) {
      logger.warn({ error: query.error }, 'Google OAuth denied by user');
      return reply.redirect(`${env.FRONTEND_URL}/login?error=google_denied`);
    }

    if (!query.code) {
      return reply.redirect(`${env.FRONTEND_URL}/login?error=no_code`);
    }

    if (
      !env.GOOGLE_CLIENT_ID ||
      !env.GOOGLE_CLIENT_SECRET ||
      !env.GOOGLE_REDIRECT_URI
    ) {
      return reply.redirect(
        `${env.FRONTEND_URL}/login?error=google_not_configured`
      );
    }

    try {
      // 1. Exchange authorization code for access token
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: query.code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: env.GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        logger.error(
          { status: tokenRes.status, body: errBody },
          'Google token exchange failed'
        );
        return reply.redirect(`${env.FRONTEND_URL}/login?error=token_exchange`);
      }

      const tokenData = (await tokenRes.json()) as { access_token: string };

      // 2. Fetch the user's Google profile
      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userRes.ok) {
        logger.error({ status: userRes.status }, 'Google userinfo failed');
        return reply.redirect(`${env.FRONTEND_URL}/login?error=userinfo`);
      }

      const googleUser = (await userRes.json()) as {
        email: string;
        email_verified: boolean;
        name?: string;
      };

      if (!googleUser.email || !googleUser.email_verified) {
        return reply.redirect(
          `${env.FRONTEND_URL}/login?error=email_not_verified`
        );
      }

      // 3. Find or create the user in our DB
      let [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, googleUser.email))
        .limit(1);

      if (!user) {
        [user] = await db
          .insert(users)
          .values({
            email: googleUser.email,
            passwordHash: null,
            provider: 'google',
          })
          .returning();

        logger.info(
          { userId: user.id, email: user.email },
          'New Google user created'
        );
      } else {
        logger.info(
          { userId: user.id, email: user.email, provider: user.provider },
          'Existing user signed in via Google'
        );
      }

      // 4. Issue our own JWT (same as email/password flow)
      const token = app.jwt.sign({ userId: user.id, email: user.email });

      // 5. Redirect to the frontend callback page with the token
      const redirectUrl = new URL(`${env.FRONTEND_URL}/auth/callback`);
      redirectUrl.searchParams.set('token', token);
      redirectUrl.searchParams.set('id', String(user.id));
      redirectUrl.searchParams.set('email', user.email);

      return reply.redirect(redirectUrl.toString());
    } catch (err) {
      logger.error({ err }, 'Google OAuth callback error');
      return reply.redirect(`${env.FRONTEND_URL}/login?error=server_error`);
    }
  });
}