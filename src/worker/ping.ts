import { logger } from '../lib/logger.js';

export interface PingResult {
  isUp: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
}

const TIMEOUT_MS = 10_000;

export async function pingUrl(url: string): Promise<PingResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'PulseWatch/1.0 (+https://pulsewatch.dev)',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);
    const responseTimeMs = Date.now() - start;

    // Consider 2xx and 3xx as "up"
    const isUp = res.status >= 200 && res.status < 400;

    return {
      isUp,
      statusCode: res.status,
      responseTimeMs,
      errorMessage: null,
    };
  } catch (err: any) {
    const responseTimeMs = Date.now() - start;

    const errorMessage =
      err.name === 'AbortError'
        ? `Timeout (${TIMEOUT_MS}ms)`
        : err.message || 'Unknown error';

    return {
      isUp: false,
      statusCode: null,
      responseTimeMs: null,
      errorMessage,
    };
  }
}