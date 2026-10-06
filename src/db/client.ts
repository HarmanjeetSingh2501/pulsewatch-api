import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env.js';
import * as schema from './schema.js';

// ─── Connection pool ──────────────────────────────────────
const queryClient = postgres(env.DATABASE_URL, {
  max: 10,              // Max connections in pool
  idle_timeout: 20,     // Close idle connections after 20s
  connect_timeout: 10,  // Fail fast if DB is unreachable
});

// ─── Drizzle client ───────────────────────────────────────
export const db = drizzle(queryClient, { schema });

// ─── Raw Postgres client (for edge cases) ─────────────────
export { queryClient };

// ─── Graceful shutdown ────────────────────────────────────
export async function closeDb() {
  await queryClient.end();
}

// ─── Health check ─────────────────────────────────────────
export async function checkDbConnection(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}