import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().url(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),

  UPSTASH_REDIS_URL: z.string().url().optional().or(z.literal('')),
  UPSTASH_REDIS_TOKEN: z.string().optional().or(z.literal('')),

  GEMINI_API_KEY: z.string().optional().or(z.literal('')),
  RESEND_API_KEY: z.string().optional().or(z.literal('')),

  FRONTEND_URL: z.string().url().default('http://localhost:3001'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';