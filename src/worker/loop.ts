import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { urls, pings } from "../db/schema.js";
import { pingUrl } from "./ping.js";
import { handleIncidentState } from "./incidents.js";
import { logger } from "../lib/logger.js";

const TICK_INTERVAL_MS = 10_000; // in-memory only, never touches the DB
const FLUSH_INTERVAL_MS = 5 * 60_000; // batch-write pings every 5 min
const FLUSH_MAX_BUFFER = 500; // flush early if the buffer gets this big
const MAX_BUFFER_HARD_CAP = 5_000; // drop oldest if DB is down for a long time
const MAX_BACKOFF_MS = 30 * 60_000;

type UrlRow = typeof urls.$inferSelect;
type PingInsert = typeof pings.$inferInsert;

interface ScheduledUrl {
  id: UrlRow["id"];
  url: string;
  intervalMs: number;
  nextCheckAt: number; // epoch ms, memory only
  lastIsUp: boolean | null; // used to detect up/down transitions
  inFlight: boolean;
}

const schedule = new Map<UrlRow["id"], ScheduledUrl>();
let pingBuffer: PingInsert[] = [];
let flushBackoffMs = 0;
let nextFlushAllowedAt = 0;
let flushing = false;

/** Load all active URLs from the DB into memory. Called once at startup. */
export async function refreshSchedule() {
  const rows = await db.select().from(urls).where(eq(urls.isActive, true));
  const seen = new Set<UrlRow["id"]>();

  rows.forEach((row, i) => {
    seen.add(row.id);
    upsertScheduled(row, i * 500); // stagger first checks a little
  });

  for (const id of schedule.keys()) {
    if (!seen.has(id)) schedule.delete(id);
  }
  logger.info({ count: schedule.size }, "Schedule loaded");
}

function upsertScheduled(row: UrlRow, delayMs = 0) {
  const existing = schedule.get(row.id);
  schedule.set(row.id, {
    id: row.id,
    url: row.url,
    intervalMs: row.checkIntervalSeconds * 1000,
    nextCheckAt: existing?.nextCheckAt ?? Date.now() + delayMs,
    lastIsUp: existing?.lastIsUp ?? null,
    inFlight: existing?.inFlight ?? false,
  });
}

/** Call from API routes after creating/updating a URL. */
export function scheduleUrl(row: UrlRow) {
  if (row.isActive) upsertScheduled(row);
  else schedule.delete(row.id);
}

/** Call from API routes after deleting a URL. */
export function unscheduleUrl(id: UrlRow["id"]) {
  schedule.delete(id);
}

async function checkOne(item: ScheduledUrl) {
  item.inFlight = true;
  try {
    const result = await pingUrl(item.url);

    pingBuffer.push({
      urlId: item.id,
      statusCode: result.statusCode,
      responseTimeMs: result.responseTimeMs,
      isUp: result.isUp,
      errorMessage: result.errorMessage,
    });
    if (pingBuffer.length > MAX_BUFFER_HARD_CAP) {
      pingBuffer = pingBuffer.slice(-MAX_BUFFER_HARD_CAP);
    }

    // Only hit the DB for incident logic when the state actually changes
    // (or on the first check after startup). handleIncidentState is
    // idempotent, so this is equivalent to calling it every check.
    if (item.lastIsUp !== result.isUp) {
      // Flush first so the AI summary / incident pages see the latest pings.
      await flushPings(true);
      try {
        await handleIncidentState(item.id, result.isUp);
        item.lastIsUp = result.isUp;
      } catch (err) {
        logger.error({ err, urlId: item.id }, "Incident handling failed");
        // lastIsUp not updated -> retried on the next check
      }
    }

    logger.debug(
      { urlId: item.id, isUp: result.isUp, statusCode: result.statusCode },
      "Ping complete",
    );
  } finally {
    item.nextCheckAt = Date.now() + item.intervalMs;
    item.inFlight = false;
  }
}

async function flushPings(force = false) {
  if (flushing || pingBuffer.length === 0) return;
  if (!force && Date.now() < nextFlushAllowedAt) return;

  flushing = true;
  const batch = pingBuffer;
  pingBuffer = [];
  try {
    await db.insert(pings).values(batch);
    flushBackoffMs = 0;
    nextFlushAllowedAt = 0;
    logger.info({ count: batch.length }, "Flushed pings");
  } catch (err) {
    // Put the batch back and back off exponentially
    pingBuffer = batch.concat(pingBuffer).slice(-MAX_BUFFER_HARD_CAP);
    flushBackoffMs = Math.min(
      flushBackoffMs ? flushBackoffMs * 2 : 60_000,
      MAX_BACKOFF_MS,
    );
    nextFlushAllowedAt = Date.now() + flushBackoffMs;
    logger.error(
      { err, retryInMs: flushBackoffMs, buffered: pingBuffer.length },
      "Ping flush failed",
    );
  } finally {
    flushing = false;
  }
}

export async function startWorkerLoop() {
  logger.info("Worker loop started");

  // Load the schedule; if the DB isn't ready, keep retrying (60s) instead of
  // leaving the worker permanently empty.
  const loadWithRetry = async () => {
    try {
      await refreshSchedule();
    } catch (err) {
      logger.error({ err }, "Schedule load failed, retrying in 60s");
      setTimeout(() => void loadWithRetry(), 60_000);
    }
  };
  await loadWithRetry();

  // Tick: memory only
  setInterval(() => {
    const now = Date.now();
    for (const item of schedule.values()) {
      if (item.inFlight || item.nextCheckAt > now) continue;
      checkOne(item).catch((err) =>
        logger.error({ err, urlId: item.id }, "Check failed"),
      );
    }

    if (pingBuffer.length >= FLUSH_MAX_BUFFER) void flushPings();
  }, TICK_INTERVAL_MS);

  // Periodic batched write
  setInterval(() => void flushPings(), FLUSH_INTERVAL_MS);
}

/** Call from the shutdown handler so buffered pings aren't lost. */
export async function flushPendingPings() {
  await flushPings(true);
}
