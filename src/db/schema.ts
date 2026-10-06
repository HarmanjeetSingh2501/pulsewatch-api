import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  varchar,
  index,
  numeric,
} from 'drizzle-orm/pg-core';

// ─── USERS ────────────────────────────────────────────────
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── URLS ─────────────────────────────────────────────────
export const urls = pgTable(
  'urls',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    url: text('url').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    checkIntervalSeconds: integer('check_interval_seconds').default(30).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    nextCheckAt: timestamp('next_check_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    nextCheckIdx: index('urls_next_check_idx').on(table.nextCheckAt),
    userIdx: index('urls_user_idx').on(table.userId),
  })
);

// ─── PINGS ────────────────────────────────────────────────
// Append-only. Grows fast — retention job in Week 4 handles cleanup.
export const pings = pgTable(
  'pings',
  {
    id: serial('id').primaryKey(),
    urlId: integer('url_id')
      .references(() => urls.id, { onDelete: 'cascade' })
      .notNull(),
    statusCode: integer('status_code'),
    responseTimeMs: integer('response_time_ms'),
    isUp: boolean('is_up').notNull(),
    errorMessage: text('error_message'),
    checkedAt: timestamp('checked_at').defaultNow().notNull(),
  },
  (table) => ({
    urlCheckedIdx: index('pings_url_checked_idx').on(
      table.urlId,
      table.checkedAt
    ),
  })
);

// ─── INCIDENTS ────────────────────────────────────────────
// Deterministic detection. AI columns filled in Week 3.
export const incidents = pgTable(
  'incidents',
  {
    id: serial('id').primaryKey(),
    urlId: integer('url_id')
      .references(() => urls.id, { onDelete: 'cascade' })
      .notNull(),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
    status: varchar('status', { length: 20 }).notNull(), // 'open' | 'resolved'
    errorType: varchar('error_type', { length: 50 }),

    // Week 3 — AI fields
    aiSummary: text('ai_summary'),
    promptVersion: integer('prompt_version'),
    aiGeneratedAt: timestamp('ai_generated_at'),
  },
  (table) => ({
    urlStatusIdx: index('incidents_url_status_idx').on(
      table.urlId,
      table.status
    ),
  })
);

// ─── PING ROLLUPS (Week 4 — optional) ─────────────────────
// Aggregated hourly data. Keeps DB small after retention kicks in.
export const pingRollups = pgTable(
  'ping_rollups',
  {
    urlId: integer('url_id')
      .references(() => urls.id, { onDelete: 'cascade' })
      .notNull(),
    hourBucket: timestamp('hour_bucket').notNull(),
    avgResponseTime: integer('avg_response_time'),
    uptimePercent: numeric('uptime_percent', { precision: 5, scale: 2 }),
    pingCount: integer('ping_count'),
  },
  (table) => ({
    pk: index('ping_rollups_pk').on(table.urlId, table.hourBucket),
  })
);

// ─── TYPES (for use across the app) ───────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Url = typeof urls.$inferSelect;
export type NewUrl = typeof urls.$inferInsert;

export type Ping = typeof pings.$inferSelect;
export type NewPing = typeof pings.$inferInsert;

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;

export type PingRollup = typeof pingRollups.$inferSelect;
export type NewPingRollup = typeof pingRollups.$inferInsert;