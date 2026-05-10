/**
 * Pure utility functions for perf/stats aggregation.
 * Extracted from roomRuntime so they can be shared and tested in isolation.
 */

export function sortedNumeric(values) {
  return values.slice().sort((a, b) => a - b);
}

export function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = sortedNumeric(values);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(ratio * (sorted.length - 1))),
  );
  return sorted[index];
}

export function avg(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
