/**
 * Deterministic anomaly detection using rolling z-score.
 *
 * The idea:
 *   1. Take a rolling window of recent successful response times (e.g. last hour)
 *   2. Compute mean and standard deviation
 *   3. z = (current - mean) / stddev
 *   4. If z >= Z_THRESHOLD, the current response is anomalous ("degraded")
 *
 * This is NOT AI. It's pure statistics. The AI is only used to
 * *explain* the anomaly in the incident summary — never to *decide*.
 */

export const Z_THRESHOLD = 3; // 3-sigma is the industry standard

export interface AnomalyResult {
  isAnomalous: boolean;
  zScore: number;
  mean: number | null;
  stdDev: number | null;
  sampleSize: number;
}

/**
 * Compute mean and standard deviation from an array of numbers.
 * Returns null values if there aren't enough samples to be meaningful.
 */
function computeStats(samples: number[]): {
  mean: number | null;
  stdDev: number | null;
} {
  // Require at least 5 samples to compute a meaningful baseline
  if (samples.length < 5) {
    return { mean: null, stdDev: null };
  }

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

  const variance =
    samples.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
    samples.length;

  const stdDev = Math.sqrt(variance);

  return { mean, stdDev };
}

/**
 * Score the current value against a rolling baseline of recent samples.
 *
 * @param current   The most recent response time (ms). Must be non-null.
 * @param baseline  Array of historical response times (ms). Must have >= 5 items.
 */
export function scoreAnomaly(
  current: number,
  baseline: number[]
): AnomalyResult {
  const { mean, stdDev } = computeStats(baseline);

  // Not enough data to judge
  if (mean === null || stdDev === null) {
    return {
      isAnomalous: false,
      zScore: 0,
      mean,
      stdDev,
      sampleSize: baseline.length,
    };
  }

  // If stdDev is 0 (all samples identical), we can't compute z — treat as normal
  if (stdDev === 0) {
    return {
      isAnomalous: false,
      zScore: 0,
      mean,
      stdDev,
      sampleSize: baseline.length,
    };
  }

  const zScore = (current - mean) / stdDev;

  return {
    isAnomalous: zScore >= Z_THRESHOLD,
    zScore,
    mean,
    stdDev,
    sampleSize: baseline.length,
  };
}

/**
 * Interpret a z-score into a human-readable severity.
 */
export function describeZScore(z: number): {
  label: 'normal' | 'elevated' | 'high' | 'extreme';
  color: 'green' | 'amber' | 'red';
} {
  if (z < 2) return { label: 'normal', color: 'green' };
  if (z < 3) return { label: 'elevated', color: 'amber' };
  if (z < 4) return { label: 'high', color: 'red' };
  return { label: 'extreme', color: 'red' };
}